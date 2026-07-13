#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { probePrerequisites } from "../services/prerequisites.js";

const HELP = `dispatch — local Kanban that turns Linear tickets into Claude Code sessions

Usage:
  dispatch [--port <n>] [--no-open]   Boot the app and open the browser
  dispatch doctor                     Check required binaries, then exit
  dispatch --help | --version

Options:
  --port <n>   Preferred port (falls back to a free port if taken)
  --no-open    Do not auto-open the browser`;

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
    const prereqs = await probePrerequisites();
    for (const p of prereqs) {
      process.stdout.write(
        p.present ? `  ✓ ${p.name}\n` : `  ✗ ${p.name} — ${p.hint}\n`,
      );
    }
    process.exit(prereqs.every((p) => p.present) ? 0 : 1);
  }
  if (positionals.length > 0) {
    process.stderr.write(`Unknown command: ${positionals[0]}\n\n${HELP}\n`);
    process.exit(2);
  }

  process.env.NODE_ENV ??= "production";
  const desiredPort = values.port ? Number(values.port) : undefined;
  const { main } = await import("./index.js");
  const { port } = await main({ desiredPort });
  const url = `http://127.0.0.1:${port}`;
  process.stdout.write(`\n  Dispatch is running at ${url}\n\n`);
  if (!values["no-open"]) openBrowser(url);
}

void cli();
