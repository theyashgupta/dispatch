#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  installArgv,
  probePreflight,
  runInstall,
} from "../services/preflight.js";
import {
  renderPlan,
  runUninstall,
  scanFootprint,
} from "../services/uninstall.js";

const HELP = `dispatch — local Kanban that turns Linear tickets into Claude Code sessions

Usage:
  dispatch [--port <n>] [--no-open]   Boot the app and open the browser
  dispatch doctor                     Check required binaries, then exit
  dispatch uninstall [--purge] [--dry-run] [--yes]
                                      Stop dispatch sessions and remove its config/hooks
  dispatch --help | --version

Options:
  --port <n>   Preferred port (falls back to a free port if taken)
  --no-open    Do not auto-open the browser
  --purge      uninstall: also delete board data (your playbooks are still kept)
  --dry-run    uninstall: print the plan and change nothing
  --yes        uninstall: skip the confirmation prompt

Uninstall never deletes git worktrees — it lists them for you to remove.`;

/**
 * Read the package version from the nearest ancestor package.json so `--version` reports the same
 * string whether run from `dist/` or `src/`; walking up (not a hardcoded path) survives both layouts.
 */
function readVersion(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf8"),
      ) as {
        name?: string;
        version?: string;
      };
      if (pkg.name) return pkg.version ?? "0.0.0";
    } catch {}
    dir = dirname(dir);
  }
  return "0.0.0";
}

/**
 * Best-effort native browser opener. Spawned detached with a URL argv (never a shell string) and
 * every failure swallowed so a headless/CI box or a missing opener never crashes the boot.
 */
function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {}
}

/**
 * Read a yes/no confirmation from stdin, resolving a bare Enter to `defaultYes` so the answer always
 * matches the prompt copy the caller printed. Only called on the interactive branch (a real TTY), so
 * it never blocks a pipe/CI run.
 * @remarks `defaultYes` is deliberately explicit at every call site rather than defaulted: an
 * additive install (`[Y/n]`) and a destructive uninstall (`[y/N]`) must never share a default, and a
 * silent default is exactly how a bare Enter would come to mean "yes, destroy it". Ctrl-D (EOF)
 * closes the interface without ever firing `line`, so `close` resolves the same default a bare Enter
 * would — without it the promise never settles and the caller's cancel path never prints. The answer
 * is settled BEFORE `rl.close()` so the close handler loses the race it would otherwise win and
 * overwrite a real answer with the default.
 */
function confirm(
  promptText: string,
  opts: { defaultYes: boolean },
): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    let settled = false;
    const settle = (answer: boolean) => {
      if (settled) return;
      settled = true;
      resolve(answer);
    };
    rl.on("close", () => settle(opts.defaultYes));
    rl.question(promptText, (ans) => {
      const t = ans.trim();
      settle(t === "" ? opts.defaultYes : /^y(es)?$/i.test(t));
      rl.close();
    });
  });
}

/**
 * Render the preflight report and, in an interactive terminal, offer to install each missing
 * installable binary (`[Y/n]`, run on yes). Under a pipe/CI it prints the command and never prompts
 * or spawns (INST-02/03). ALWAYS resolves without a non-zero exit — `doctor` is a diagnostic, not a
 * gate (Pitfall 3): a missing binary, below-floor Node, or unhealthy storage renders a line but the
 * command still succeeds (PRE-03).
 */
async function doctor(): Promise<void> {
  const report = await probePreflight();
  for (const p of report.binaries) {
    process.stdout.write(
      p.present
        ? `  ✓ ${p.name}\n`
        : `  ✗ ${p.name} — ${p.command ?? p.hint ?? "not installable"}\n`,
    );
  }
  process.stdout.write(
    report.node.ok
      ? `  ✓ Node ${report.node.version}\n`
      : `  ⚠ Node ${report.node.version} — below supported floor (${report.node.floor})\n`,
  );
  process.stdout.write(
    report.storage.ok
      ? `  ✓ Storage OK — ${report.storage.path}\n`
      : `  ✗ Storage check failed — ${report.storage.path}\n`,
  );

  const interactive =
    Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;
  for (const p of report.binaries) {
    if (p.present || !installArgv(p.name)) continue;
    if (!interactive) continue;
    const yes = await confirm(
      `  Install ${p.name} with "${p.command}"? [Y/n] `,
      {
        defaultYes: true,
      },
    );
    if (!yes) continue;
    const { ok, command, status } = await runInstall(p.name, {
      interactive: true,
    });
    process.stdout.write(
      ok
        ? `  ✓ ${status.name} installed\n`
        : `  ✗ ${status.name} still missing — run manually: ${command}\n`,
    );
  }
}

/**
 * Reverse dispatch's own footprint, gated behind the layered consent this command's destructiveness
 * demands: `--dry-run` only ever previews (and WINS over `--yes`, so a scripted dry run can never
 * execute); a no-TTY run without `--yes` REFUSES and changes nothing rather than destroying data it
 * could not confirm; and an interactive run must clear a DEFAULT-NO prompt where a bare Enter
 * cancels. Every branch renders through the one `renderPlan`, so the preview, the confirmation, and
 * the post-run report can never describe a different set than the one acted on, and every branch
 * exits 0 — a nothing-to-do uninstall is a success, not an error.
 */
async function uninstall(values: {
  "dry-run"?: boolean;
  purge?: boolean;
  yes?: boolean;
}): Promise<void> {
  const plan = await scanFootprint({ purge: Boolean(values.purge) });

  if (values["dry-run"]) {
    process.stdout.write(renderPlan(plan));
    return;
  }

  const interactive =
    Boolean(process.stdin.isTTY && process.stdout.isTTY) && !process.env.CI;

  if (!values.yes) {
    process.stdout.write(renderPlan(plan));
    if (!interactive) {
      process.stdout.write(
        `\n  Not a terminal — nothing was changed. Re-run with --yes to proceed.\n`,
      );
      return;
    }
    if (!(await confirm(`  Proceed? [y/N] `, { defaultYes: false }))) {
      process.stdout.write(`  Cancelled — nothing was changed.\n`);
      return;
    }
    process.stdout.write("\n");
  }

  const stopped = plan.stop.sessions.length;
  const { plan: done, removed, failed } = await runUninstall(plan);
  process.stdout.write(
    `  Removed ${removed.length} file(s), stopped ${stopped} session(s).\n`,
  );
  if (failed.length > 0) {
    process.stdout.write(`  Failed to remove ${failed.length} file(s):\n`);
    for (const f of failed) {
      process.stdout.write(`    ${f.path}  (${f.reason})\n`);
    }
  }
  process.stdout.write("\n");
  process.stdout.write(renderPlan(done));
}

async function cli(): Promise<void> {
  let result;
  try {
    result = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: true,
      strict: true,
      options: {
        port: { type: "string" },
        "no-open": { type: "boolean" },
        purge: { type: "boolean" },
        "dry-run": { type: "boolean" },
        yes: { type: "boolean" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
      },
    });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}\n`);
    process.exit(2);
  }
  const { values, positionals } = result;

  if (values.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (values.version) {
    process.stdout.write(`${readVersion()}\n`);
    return;
  }

  if (positionals[0] === "doctor") {
    await doctor();
    process.exit(0);
  }
  if (positionals[0] === "uninstall") {
    await uninstall(values);
    process.exit(0);
  }
  if (positionals.length > 0) {
    process.stderr.write(`Unknown command: ${positionals[0]}\n\n${HELP}\n`);
    process.exit(2);
  }

  process.env.NODE_ENV ??= "production";
  const desiredPort = values.port ? Number(values.port) : undefined;
  if (
    desiredPort !== undefined &&
    (!Number.isInteger(desiredPort) || desiredPort < 1 || desiredPort > 65535)
  ) {
    process.stderr.write(
      `Invalid --port value: ${values.port} (expected an integer 1–65535)\n`,
    );
    process.exit(2);
  }
  const { main } = await import("./index.js");
  const { port } = await main({ desiredPort });
  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(`\n  Dispatch is running at ${url}\n\n`);
  if (!values["no-open"]) openBrowser(url);
}

void cli();
