import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import writeFileAtomic from "write-file-atomic";
import { run } from "../../adapters/exec.js";
import {
  CONFIG_PATH,
  SERVICE_ERR_LOG_PATH,
  SERVICE_LABEL,
  SERVICE_LOG_PATH,
  SERVICE_PLIST_PATH,
} from "../infra/paths.js";
import { detectInstallMode } from "./update.js";

const DEFAULT_PORT = 4700;

/**
 * Resolve the absolute path to the running copy's built `cli.js`, walking up from this module's own
 * `import.meta.url` (never `process.argv[1]`, which reflects the unresolved npm bin symlink, not the
 * real on-disk location — the same reasoning `detectInstallMode`/`readVersion` already rely on).
 * @remarks The plist's `ProgramArguments` must hold an absolute path launchd can exec directly,
 * independent of the dev-vs-dist layout: from a global npm install this walk finds the package root
 * a few levels up; a hardcoded relative or dev-only path would silently break the moment this file
 * moves between `src/` and `dist/`.
 */
export function resolveCliEntry(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as { name?: string };
      if (pkg.name) return join(dir, "dist", "server", "bootstrap", "cli.js");
    } catch {}
    dir = dirname(dir);
  }
  return join(dir, "dist", "server", "bootstrap", "cli.js");
}

/** Escape the five XML-significant characters so any interpolated value is well-formed plist body. */
function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Decode the same five XML entities {@link xmlEscape} applies, in the mirror order.
 * @remarks `&amp;` decodes LAST: decoding it first would turn an original literal `&lt;` (already
 * escaped once to `&amp;lt;`) back into `&lt;` and then, on the next pass, into `<`, corrupting text
 * that was never meant to become a tag.
 */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Extract the ordered `ProgramArguments` string values from a rendered plist.
 * @remarks No XML parser: this file's plist schema is generated exclusively by {@link buildPlist},
 * so a narrow scan of its own known shape is enough, and pulling in a general parser for a
 * self-controlled, narrow-schema file would be overkill. Returns an empty array when the key or
 * its `<array>` block is missing, which {@link healServicePlist} treats as unconditionally stale.
 */
function extractProgramArguments(xml: string): string[] {
  const keyIndex = xml.indexOf("<key>ProgramArguments</key>");
  if (keyIndex === -1) return [];
  const arrayStart = xml.indexOf("<array>", keyIndex);
  const arrayEnd = xml.indexOf("</array>", arrayStart);
  if (arrayStart === -1 || arrayEnd === -1) return [];
  const block = xml.slice(arrayStart, arrayEnd);
  const values: string[] = [];
  const stringRe = /<string>([\s\S]*?)<\/string>/g;
  let match: RegExpExecArray | null;
  while ((match = stringRe.exec(block)) !== null) {
    values.push(decodeXmlEntities(match[1]));
  }
  return values;
}

/**
 * Extract the `EnvironmentVariables.PATH` value from a rendered plist, undefined when absent.
 * @remarks Same narrow self-schema scan as {@link extractProgramArguments}: {@link buildPlist} is
 * the only writer of this file, and `PATH` is its only `EnvironmentVariables` key.
 */
function extractEnvironmentPath(xml: string): string | undefined {
  const match = /<key>PATH<\/key>\s*<string>([\s\S]*?)<\/string>/.exec(xml);
  return match ? decodeXmlEntities(match[1]) : undefined;
}

/**
 * Render the launchd plist XML. A pure function — no filesystem/process access — so `--print` can
 * render it with zero side effects and `installService` can write the exact string it renders.
 * @remarks Every interpolated value is XML-escaped: the captured `PATH` and filesystem paths
 * routinely contain `&`, and an unescaped value would hand launchd a malformed (or attacker-shaped)
 * plist. `EnvironmentVariables.PATH` is the load-bearing entry — launchd's own default environment
 * cannot find `tmux`/`ttyd`/`git`/`claude` on `$PATH`, so the service would boot into a broken
 * preflight without it.
 */
export function buildPlist(opts: {
  cliEntry: string;
  nodePath: string;
  path: string;
  port?: number;
}): string {
  const args = [
    opts.nodePath,
    opts.cliEntry,
    "--no-open",
    ...(opts.port !== undefined ? ["--port", String(opts.port)] : []),
  ];
  const programArguments = args
    .map((a) => `    <string>${xmlEscape(a)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(SERVICE_LABEL)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${xmlEscape(opts.path)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(SERVICE_LOG_PATH)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(SERVICE_ERR_LOG_PATH)}</string>
</dict>
</plist>
`;
}

/**
 * Bootout then bootstrap the agent so launchd re-reads the on-disk plist, reporting success only
 * when `launchctl print` confirms the job is loaded afterwards.
 * @remarks `bootout` returns before launchd has finished tearing the job down, so the unload is
 * polled to completion first; a `bootstrap` that lands inside that window fails with EIO or
 * "already loaded" and leaves the job unloaded. `bootstrap`'s exit code is known to lie in both
 * directions, so only the post-condition (`print` succeeds after a confirmed unload) counts as
 * success. A job left unloaded is only recoverable through `dispatch service install`, so the
 * failure message names that command rather than `restart`.
 */
async function reloadService(): Promise<boolean> {
  const uid = process.getuid?.();
  const target = `gui/${uid}/${SERVICE_LABEL}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const isLoaded = async (): Promise<boolean> => {
    try {
      await run("launchctl", ["print", target]);
      return true;
    } catch {
      return false;
    }
  };
  const describe = (err: unknown): string => {
    const e = err as (Error & { stderr?: string }) | undefined;
    return (
      (e?.stderr?.trim() || e?.message) ??
      (err === undefined ? "launchctl reported no error" : String(err))
    );
  };
  const fail = (detail: string): false => {
    process.stderr.write(
      `  Failed to load the service: ${detail}\n` +
        `  The agent may be unloaded, recover with: dispatch service install\n`,
    );
    return false;
  };

  let bootoutError: unknown;
  try {
    await run("launchctl", ["bootout", target]);
  } catch (err) {
    bootoutError = err;
  }
  let unloaded = false;
  for (const delayMs of [0, 200, 400, 800]) {
    if (delayMs > 0) await sleep(delayMs);
    if (!(await isLoaded())) {
      unloaded = true;
      break;
    }
  }
  if (!unloaded)
    return fail(`bootout did not unload ${target}: ${describe(bootoutError)}`);

  let lastError: unknown;
  for (const delayMs of [0, 400, 1200]) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      await run("launchctl", ["bootstrap", `gui/${uid}`, SERVICE_PLIST_PATH]);
    } catch (err) {
      lastError = err;
    }
    if (await isLoaded()) return true;
  }
  return fail(
    lastError === undefined
      ? `bootstrap returned 0 but launchd reports ${target} absent`
      : describe(lastError),
  );
}

/**
 * Compare the on-disk plist's `ProgramArguments` against what {@link resolveCliEntry} returns right
 * now, and rewrite it through {@link buildPlist} when they differ.
 * @remarks Only entries 0 and 1 (`nodePath`, `cliEntry`) are compared, since `EnvironmentVariables.PATH`
 * legitimately differs between a launchd-started and a shell-started process, so comparing it would
 * rewrite the plist on every call. The existing plist's `--port` entry (if any) and its
 * `EnvironmentVariables.PATH` are preserved rather than re-derived, so a no-port install never gains
 * one on its first heal and a heal run from a minimal shell never replaces the PATH launchd needs
 * to find `tmux`/`ttyd`/`git`/`claude`. A resolved `cliEntry` that does not exist on disk (a
 * checkout with no `dist/` built, or the walk's fallback path) is never written and is reported as
 * `"unrepairable"` so {@link restartService} can refuse instead of reloading a stale plist:
 * installing a broken entry is worse than leaving a stale one that at least points at a build
 * that once ran.
 * File-only on purpose: the boot-time caller runs inside the very agent a re-bootstrap would tear
 * down (the self-inflicted `KeepAlive` failure mode), so launchd's in-memory job is left alone and
 * only {@link restartService} reloads it. Refuses under npx like `installService` does (an npx
 * cache copy resolves a cliEntry npm will prune), and the boot caller additionally gates on a
 * packaged install (`isPackagedInstall`) and passes `repointNode: false`, so a dev checkout never
 * heals implicitly and a `dispatch` run under a different node (nvm switch) never repoints the
 * LaunchAgent's node at itself, which an `nvm uninstall` would later brick; only the explicit
 * `service restart`/`service install` may change the node.
 */
export async function healServicePlist(
  opts: { repointNode?: boolean } = {},
): Promise<"not-installed" | "unchanged" | "unrepairable" | "rewritten"> {
  if (!existsSync(SERVICE_PLIST_PATH)) return "not-installed";
  if (detectInstallMode() === "npx") return "unchanged";

  let xml = "";
  try {
    xml = readFileSync(SERVICE_PLIST_PATH, "utf8");
  } catch {}
  const current = extractProgramArguments(xml);

  const cliEntry = resolveCliEntry();
  const nodePath = process.execPath;
  if (current[0] === nodePath && current[1] === cliEntry) return "unchanged";
  if (current[0] !== nodePath && opts.repointNode === false) {
    process.stdout.write(
      `  [service] plist node (${current[0]}) differs from this process (${nodePath}); ` +
        `boot heal left it alone. To repoint: dispatch service restart\n`,
    );
    return "unchanged";
  }
  if (!existsSync(cliEntry)) {
    process.stderr.write(
      `  [service] plist is stale but the resolved entry does not exist (${cliEntry}); ` +
        `not rewriting. Re-run: dispatch service install\n`,
    );
    return "unrepairable";
  }

  let port: number | undefined;
  const portFlagIndex = current.indexOf("--port");
  if (portFlagIndex !== -1 && current[portFlagIndex + 1] !== undefined) {
    const parsed = Number(current[portFlagIndex + 1]);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535)
      port = parsed;
  }

  const path = extractEnvironmentPath(xml) || process.env.PATH || "";
  await writeFileAtomic(
    SERVICE_PLIST_PATH,
    buildPlist({ cliEntry, nodePath, path, port }),
  );
  process.stdout.write(
    `  [service] plist ProgramArguments were stale, rewrote ${SERVICE_PLIST_PATH}\n`,
  );
  return "rewritten";
}

/** Tolerant `config.json` port read, mirroring update.ts's `readCache` posture — never throws. */
function readConfiguredPort(): number | null {
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as { port?: unknown };
    return typeof parsed.port === "number" ? parsed.port : null;
  } catch {
    return null;
  }
}

/**
 * Probe whether something is already listening on loopback:`port`, so `installService` can warn
 * (never block) about a conflict — most commonly a manually-launched `dispatch` left running from
 * before the service takes over. A short timeout keeps this from ever hanging the install command.
 */
function probePortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port, timeout: 300 });
    const settle = (inUse: boolean) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/**
 * Install (or reinstall) the `dispatch` LaunchAgent. `print: true` renders the plist to stdout with
 * zero side effects — no darwin/install-mode gate applies to it, since nothing is touched.
 * @remarks Reinstall is idempotent: `launchctl bootout` is attempted and its failure (nothing
 * loaded yet) is swallowed before `bootstrap`, so re-running install after an edit or an upgrade
 * never errors on "already loaded".
 */
export async function installService(opts: {
  port?: number;
  print?: boolean;
}): Promise<number> {
  const cliEntry = resolveCliEntry();
  const nodePath = process.execPath;
  const path = process.env.PATH ?? "";

  if (opts.print) {
    process.stdout.write(
      buildPlist({ cliEntry, nodePath, path, port: opts.port }),
    );
    return 0;
  }

  if (process.platform !== "darwin") {
    process.stdout.write(
      "  dispatch service is macOS only (launchd LaunchAgents).\n",
    );
    return 1;
  }

  const installMode = detectInstallMode();
  if (installMode === "npx") {
    process.stdout.write(
      "  dispatch service needs a persistent install — run:\n" +
        "    npm i -g @theyashgupta/dispatch@latest\n" +
        "  then re-run: dispatch service install\n",
    );
    return 1;
  }

  const port = opts.port ?? readConfiguredPort() ?? DEFAULT_PORT;
  if (await probePortInUse(port)) {
    process.stdout.write(
      `  WARNING: something is already listening on 127.0.0.1:${port} (commonly a manually-\n` +
        `  launched dispatch). The service will fall back to a random port until it is stopped.\n`,
    );
  }

  mkdirSync(dirname(SERVICE_PLIST_PATH), { recursive: true });
  await writeFileAtomic(
    SERVICE_PLIST_PATH,
    buildPlist({ cliEntry, nodePath, path, port: opts.port }),
  );

  if (!(await reloadService())) return 1;

  process.stdout.write(
    `  Installed ${SERVICE_PLIST_PATH}\n` +
      `  Loaded — dispatch will run at login and restart on crash.\n` +
      `  Expected at: http://127.0.0.1:${port}\n`,
  );
  return 0;
}

/**
 * Diagnostic status, always exit 0 (mirrors `doctor`'s posture) — reporting "not installed" or "not
 * loaded" is a successful answer, not a failure.
 */
export async function serviceStatus(): Promise<number> {
  const installed = existsSync(SERVICE_PLIST_PATH);
  process.stdout.write(
    installed ? `  Installed: ${SERVICE_PLIST_PATH}\n` : "  Not installed.\n",
  );
  if (!installed) return 0;

  const uid = process.getuid?.();
  try {
    const { stdout } = await run("launchctl", [
      "print",
      `gui/${uid}/${SERVICE_LABEL}`,
    ]);
    const running = /state = running/.test(stdout);
    process.stdout.write(
      running ? "  Loaded — running\n" : "  Loaded — not running\n",
    );
  } catch {
    process.stdout.write("  Not loaded.\n");
  }
  process.stdout.write(`  Logs: ${SERVICE_LOG_PATH}\n`);
  process.stdout.write(`  Errors: ${SERVICE_ERR_LOG_PATH}\n`);
  return 0;
}

/**
 * Hard-restart the agent through a bootout/bootstrap pair. Fails with a friendly hint when nothing
 * is installed.
 * @remarks Always re-bootstraps instead of `kickstart`: launchd does not re-read the plist file on
 * `kickstart`, and a file-only boot heal may already have freshened the file while launchd still
 * holds the stale `ProgramArguments` in memory, so the file's own freshness is no signal of whether
 * a reload is pending. Re-bootstrapping unconditionally costs the same as a kickstart and makes the
 * on-disk arguments the ones that take effect.
 */
export async function restartService(): Promise<number> {
  if (!existsSync(SERVICE_PLIST_PATH)) {
    process.stdout.write(
      "  Service is not installed — run: dispatch service install\n",
    );
    return 1;
  }

  const healed = await healServicePlist();
  if (healed === "unrepairable") return 1;
  if (!(await reloadService())) return 1;
  process.stdout.write(
    healed === "rewritten"
      ? "  Restarted, service path refreshed.\n"
      : "  Restarted.\n",
  );
  return 0;
}

/**
 * Unload and remove the plist, keeping the logs (they are diagnostic history, not part of the
 * installed footprint). Idempotent — a not-loaded agent and an already-absent plist both count as
 * success, so re-running uninstall never errors.
 */
export async function uninstallService(): Promise<number> {
  const uid = process.getuid?.();
  try {
    await run("launchctl", ["bootout", `gui/${uid}/${SERVICE_LABEL}`]);
  } catch {}

  try {
    rmSync(SERVICE_PLIST_PATH);
    process.stdout.write(`  Removed ${SERVICE_PLIST_PATH}\n`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    process.stdout.write(
      code === "ENOENT"
        ? "  Service was not installed.\n"
        : `  Could not remove ${SERVICE_PLIST_PATH}: ${code ?? (err as Error).message}\n`,
    );
  }
  process.stdout.write(
    `  Logs kept at ${SERVICE_LOG_PATH} and ${SERVICE_ERR_LOG_PATH}.\n`,
  );
  return 0;
}
