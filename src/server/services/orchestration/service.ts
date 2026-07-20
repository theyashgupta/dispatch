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

  const uid = process.getuid?.();
  try {
    await run("launchctl", ["bootout", `gui/${uid}/${SERVICE_LABEL}`]);
  } catch {}

  try {
    await run("launchctl", ["bootstrap", `gui/${uid}`, SERVICE_PLIST_PATH]);
  } catch (err) {
    process.stderr.write(
      `  Failed to load the service: ${(err as Error & { stderr?: string }).stderr ?? (err as Error).message}\n`,
    );
    return 1;
  }

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

/** Kickstart (hard-restart) the loaded agent. Fails with a friendly hint when nothing is installed. */
export async function restartService(): Promise<number> {
  if (!existsSync(SERVICE_PLIST_PATH)) {
    process.stdout.write(
      "  Service is not installed — run: dispatch service install\n",
    );
    return 1;
  }
  const uid = process.getuid?.();
  try {
    await run("launchctl", ["kickstart", "-k", `gui/${uid}/${SERVICE_LABEL}`]);
  } catch (err) {
    process.stderr.write(
      `  Restart failed: ${(err as Error & { stderr?: string }).stderr ?? (err as Error).message}\n`,
    );
    return 1;
  }
  process.stdout.write("  Restarted.\n");
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
