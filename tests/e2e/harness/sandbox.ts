import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { writeFakeClaudeTui } from "../../../src/server/test-support/fake-claude-tui.js";
import {
  setGhScenario,
  writeFakeGh,
} from "../../../src/server/test-support/fake-gh.js";

const THIS_BUILD = path.resolve(import.meta.dirname, "../../..");
export const SANDBOX_ROOT = path.resolve(
  process.env.DISPATCH_E2E_SANDBOX ?? path.join(THIS_BUILD, ".sandbox/e2e"),
);
export const EVIDENCE_DIR = path.resolve(
  process.env.DISPATCH_E2E_EVIDENCE ?? path.join(SANDBOX_ROOT, "evidence"),
);
export const RELEASE_V420 = process.env.DISPATCH_E2E_V420 ?? "";
export const V420_SKIP: string | false =
  RELEASE_V420 !== "" &&
  fs.existsSync(path.join(RELEASE_V420, "dist/server/bootstrap/index.js"))
    ? false
    : "DISPATCH_E2E_V420 must name a built v4.2.0 checkout (dist/server/bootstrap/index.js is missing)";
export const PORT_FIRST = 48931;
export const PORT_LAST = 48939;
export const MINUTE = 60_000;
export const SHIP_IDENTITY = { name: "Ship Bot", email: "ship@example.com" };
const RESERVED_PORTS = new Set([4700, 4710, 47990, 5291]);
const READ_ONLY_TMUX = new Set([
  "capture-pane",
  "list-sessions",
  "list-panes",
  "has-session",
  "display-message",
  "show-environment",
]);
const STRIPPED_PREFIXES = ["DISPATCH_", "CLAUDE_", "ANTHROPIC_"];
const STRIPPED_NAMES = new Set(["TMUX", "TMUX_PANE", "NODE_ENV"]);

interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

export interface Sandbox {
  url: string;
  port: number;
  root: string;
  dir: string;
  home: string;
  workspaces: string;
  bin: string;
  scenarios: string;
  logs: string;
  serverLog: string;
  claude: string;
  gh: { log: string; scenario: string };
  tmuxLabel: string;
  pid: number;
  api: <T = unknown>(
    method: string,
    route: string,
    body?: unknown,
  ) => Promise<ApiResult<T>>;
  orchestrationEvents: (boardKey: string) => Promise<OrchestrationEventRow[]>;
  tmux: (args: string[]) => string;
  pause: (ms: number) => Promise<void>;
  stopServer: () => Promise<void>;
  stop: () => Promise<void>;
}

interface SandboxOptions {
  name: string;
  buildRoot?: string;
  reuseDir?: boolean;
}

export interface OrchestrationEventRow {
  id: number;
  boardKey: string;
  cardId: string | null;
  sessionId: string | null;
  kind: string;
  data: Record<string, unknown>;
  ts: string;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Return a logger that prefixes each line with `tag` and the seconds since this call. */
export function makeNote(tag: string): (text: string) => void {
  const started = Date.now();
  return (text) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`[${tag} +${seconds}s] ${text}`);
  };
}

/**
 * Poll `fn` until it returns a truthy value, and throw naming `label` on timeout.
 *
 * @remarks A thrown error inside `fn` counts as "not yet", and the last one is attached to the timeout message.
 * A `fatal` error ends the poll at once, and an aborted `signal` ends it too, so a watcher never outlives its test.
 */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  timeoutMs: number,
  label: string,
  opts: {
    pollMs?: number;
    signal?: AbortSignal;
    fatal?: () => Error | undefined;
  } = {},
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    if (opts.signal?.aborted) throw new Error(`stopped waiting for ${label}`);
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    const dead = opts.fatal?.();
    if (dead) throw dead;
    if (Date.now() >= deadline) {
      const why = lastError instanceof Error ? ` (${lastError.message})` : "";
      throw new Error(
        `timed out after ${timeoutMs} ms waiting for ${label}${why}`,
      );
    }
    await sleep(opts.pollMs ?? 250);
  }
}

/**
 * Throw unless `port` is inside this unit's range and not one of the reserved service ports.
 *
 * @remarks Every harness shares this rule, so no scenario can reach a port that a live service owns.
 */
export function assertSafePort(port: number): void {
  if (
    !Number.isInteger(port) ||
    port < PORT_FIRST ||
    port > PORT_LAST ||
    RESERVED_PORTS.has(port)
  ) {
    throw new Error(`port ${port} is refused by the sandbox rules`);
  }
}

/** Parse a response text as JSON, and return the text itself when it is not JSON and null when it is empty. */
function parseBody(text: string): unknown {
  if (text === "") return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

/**
 * Throw when a real dispatch service answers on port 4700.
 *
 * @remarks Server boot sweeps every ttyd process without an instance key on the machine, so a run beside an older live service would kill its terminals.
 */
async function assertNoLiveService(): Promise<void> {
  const live = await fetch("http://127.0.0.1:4700/api/board", {
    signal: AbortSignal.timeout(2000),
  }).then(
    (res) => {
      void res.body?.cancel();
      return true;
    },
    () => false,
  );
  if (live) {
    throw new Error(
      "a dispatch service answers on http://127.0.0.1:4700, so the sandbox refuses to boot. Stop it first.",
    );
  }
}

const PORT_LOCKS = path.join(SANDBOX_ROOT, ".ports");

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claim the first port in 48931..48939 that is free and not locked by a live test process.
 *
 * @remarks Two spec files run in parallel under `node --test`, so a free port alone is not enough:
 * each claim writes a lock file with the owner pid, and a lock of a dead pid is taken over. A release
 * runs once and removes only a lock that still holds this pid.
 */
async function claimPort(): Promise<{ port: number; release: () => void }> {
  fs.mkdirSync(PORT_LOCKS, { recursive: true });
  for (let port = PORT_FIRST; port <= PORT_LAST; port++) {
    assertSafePort(port);
    const lock = path.join(PORT_LOCKS, `${port}.lock`);
    if (!(await portIsFree(port))) continue;
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: "wx" });
    } catch {
      const owner = Number(fs.readFileSync(lock, "utf8"));
      if (processAlive(owner)) continue;
      fs.writeFileSync(lock, String(process.pid));
    }
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      if (
        fs.existsSync(lock) &&
        fs.readFileSync(lock, "utf8") === String(process.pid)
      ) {
        fs.rmSync(lock, { force: true });
      }
    };
    return { port, release };
  }
  throw new Error(`no free port in ${PORT_FIRST}..${PORT_LAST}`);
}

/** Return the tmux server label the product derives from a data folder (`src/server/adapters/tmux.ts`). */
function tmuxLabelOf(dispatchDir: string): string {
  const id = createHash("sha256")
    .update(path.resolve(dispatchDir))
    .digest("hex")
    .slice(0, 12);
  return `dsp-${id}`;
}

/**
 * Run one read-only tmux verb against the sandbox server and return its stdout.
 *
 * @remarks `has-session`, `list-sessions` and `list-panes` exit 1 when no server or session exists, which is a normal answer and returns an empty string.
 */
function runTmux(label: string, args: string[]): string {
  const verb = args.find((a) => !a.startsWith("-"));
  if (verb === undefined || !READ_ONLY_TMUX.has(verb)) {
    throw new Error(`the sandbox tmux helper refuses "${verb}": it only reads`);
  }
  const out = spawnSync("tmux", ["-L", label, ...args], { encoding: "utf8" });
  const absentIsAnswer = [
    "has-session",
    "list-sessions",
    "list-panes",
  ].includes(verb);
  if (out.status !== 0 && !(absentIsAnswer && out.status === 1)) {
    throw new Error(`tmux ${verb} failed: ${out.stderr.trim()}`);
  }
  return out.stdout;
}

/**
 * Throw unless `claude` resolves to the fake launcher with the exact environment the server will get.
 *
 * @remarks Runs before the server starts, so a PATH mistake can never launch the real CLI.
 */
function assertFakeClaude(env: NodeJS.ProcessEnv, launcher: string): string {
  const found = spawnSync("which", ["claude"], { env, encoding: "utf8" });
  const resolved = found.stdout.trim();
  if (resolved !== launcher) {
    throw new Error(
      `claude on the server PATH is ${resolved || "missing"}, not the fake at ${launcher}`,
    );
  }
  const version = spawnSync(resolved, ["--version"], {
    env,
    encoding: "utf8",
  }).stdout;
  if (!version.includes("(fake)")) {
    throw new Error(`claude --version did not report the fake: ${version}`);
  }
  return version.trim();
}

/**
 * SIGTERM the ttyd processes of this sandbox and any fake claude left under its own bin folder.
 *
 * @remarks Both are matched by a marker that only this sandbox puts on a command line: the ttyd
 * instance key of its data folder, and the path of its own fake launcher script.
 */
function killOwnProcesses(label: string, bin: string): void {
  const instance = `DISPATCH_TTYD_INSTANCE_${label.slice(4)}`;
  const fake = path.join(bin, "fake-claude-tui.mjs");
  const listed = spawnSync("ps", ["-axww", "-o", "pid=,command="], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  for (const line of (listed.stdout ?? "").split("\n")) {
    const ownTtyd = line.includes(instance) && /\bttyd\b/.test(line);
    if (!ownTtyd && !line.includes(fake)) continue;
    const pid = Number(line.trim().split(/\s+/)[0]);
    if (Number.isInteger(pid) && pid !== process.pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        continue;
      }
    }
  }
}

function waitForExit(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Start the built server on a sandbox folder with the fake `claude` and the fake `gh` first on its PATH.
 *
 * @remarks By default the root is made from nothing under `SANDBOX_ROOT`, and an older root of the same name is
 * removed after its own tmux server is stopped. `reuseDir` keeps the root and its `dispatch-dir` and changes only
 * the port in `config.json`, and `buildRoot` names the folder whose `dist/` runs (this repository by default).
 * `HOME` points into the root so the fake transcripts, the trust file and the hook files never touch the real home folder.
 */
export async function startSandbox(opts: SandboxOptions): Promise<Sandbox> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(opts.name)) {
    throw new Error(`invalid sandbox name ${opts.name}`);
  }
  const serverEntry = path.join(
    opts.buildRoot ?? THIS_BUILD,
    "dist/server/bootstrap/index.js",
  );
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`build the server first: ${serverEntry} is missing`);
  }
  await assertNoLiveService();
  const root = path.join(SANDBOX_ROOT, opts.name);
  const dir = path.join(root, "dispatch-dir");
  const label = tmuxLabelOf(dir);
  if (opts.reuseDir) {
    if (!fs.existsSync(dir)) throw new Error(`${dir} does not exist`);
  } else if (fs.existsSync(root)) {
    spawnSync("tmux", ["-L", label, "kill-server"], { stdio: "ignore" });
    killOwnProcesses(label, path.join(root, "bin"));
    fs.rmSync(root, { recursive: true, force: true });
  }
  const home = path.join(root, "home");
  const workspaces = path.join(root, "workspaces");
  const bin = path.join(root, "bin");
  const scenarios = path.join(root, "scenarios");
  const logs = path.join(root, "logs");
  for (const d of [dir, home, workspaces, bin, scenarios, logs]) {
    fs.mkdirSync(d, { recursive: true });
  }

  const claude = writeFakeClaudeTui(bin);
  const gh = writeFakeGh(bin, root);
  setGhScenario(gh.scenario, { checks: "pass" });
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    const stripped =
      STRIPPED_NAMES.has(key) ||
      STRIPPED_PREFIXES.some((prefix) => key.startsWith(prefix));
    if (!stripped) env[key] = value;
  }
  Object.assign(env, {
    NODE_ENV: "production",
    DISPATCH_DIR: dir,
    HOME: home,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    FAKE_CLAUDE_SCENARIO_DIR: scenarios,
    DISPATCH_USAGE_URL: "http://127.0.0.1:1",
    GIT_AUTHOR_NAME: SHIP_IDENTITY.name,
    GIT_AUTHOR_EMAIL: SHIP_IDENTITY.email,
    GIT_COMMITTER_NAME: SHIP_IDENTITY.name,
    GIT_COMMITTER_EMAIL: SHIP_IDENTITY.email,
  });
  assertFakeClaude(env, claude);

  const claim = await claimPort();
  const port = claim.port;
  const serverLog = path.join(logs, "server.log");
  let server: ChildProcess;
  let pid: number;
  let spawnError: Error | undefined;
  try {
    const configFile = path.join(dir, "config.json");
    const config: Record<string, unknown> =
      opts.reuseDir && fs.existsSync(configFile)
        ? (JSON.parse(fs.readFileSync(configFile, "utf8")) as Record<
            string,
            unknown
          >)
        : {
            workspaceRoot: workspaces,
            onboardingDone: true,
            updateCheck: false,
            statusChannel: "hooks",
          };
    fs.writeFileSync(configFile, JSON.stringify({ ...config, port }));
    const fd = fs.openSync(serverLog, "w");
    server = spawn(process.execPath, [serverEntry], {
      env,
      stdio: ["ignore", fd, fd],
    });
    fs.closeSync(fd);
    server.on("error", (err) => {
      spawnError = err;
    });
    if (server.pid === undefined) throw new Error("the server did not start");
    pid = server.pid;
  } catch (err) {
    claim.release();
    throw err;
  }

  const listening = `listening on http://127.0.0.1:${port}`;
  let serverStopped: Promise<void> | undefined;
  const stopServer = (): Promise<void> =>
    (serverStopped ??= (async () => {
      if (server.exitCode === null && server.signalCode === null) {
        server.kill("SIGTERM");
        if (!(await waitForExit(server, 10_000))) server.kill("SIGKILL");
      }
      claim.release();
    })());
  let stopped: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopped ??= (async () => {
      await stopServer();
      spawnSync("tmux", ["-L", label, "kill-server"], { stdio: "ignore" });
      killOwnProcesses(label, bin);
    })());

  try {
    await waitFor(
      () => fs.readFileSync(serverLog, "utf8").includes(listening),
      40_000,
      `the server log line "${listening}"`,
      {
        fatal: () =>
          spawnError ??
          (server.exitCode === null && server.signalCode === null
            ? undefined
            : new Error(
                `server exited with ${server.exitCode ?? server.signalCode}: ${fs.readFileSync(serverLog, "utf8").slice(-600)}`,
              )),
      },
    );
  } catch (err) {
    await stop();
    throw err;
  }

  const url = `http://127.0.0.1:${port}`;
  const api = async <T = unknown>(
    method: string,
    route: string,
    body?: unknown,
  ): Promise<ApiResult<T>> => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: parseBody(text) as T };
  };

  return {
    url,
    port,
    root,
    dir,
    home,
    workspaces,
    bin,
    scenarios,
    logs,
    serverLog,
    claude,
    gh,
    tmuxLabel: label,
    pid,
    api,
    orchestrationEvents: async (boardKey) => {
      const rows: OrchestrationEventRow[] = [];
      for (;;) {
        const res = await api<{ events: OrchestrationEventRow[] }>(
          "GET",
          `/api/boards/${boardKey}/orchestration/events?since=${rows.at(-1)?.id ?? 0}&limit=1000`,
        );
        if (res.status !== 200) {
          throw new Error(`orchestration events answered ${res.status}`);
        }
        rows.push(...res.body.events);
        if (res.body.events.length < 1000) return rows;
      }
    },
    tmux: (args) => runTmux(label, args),
    pause: async (ms) => {
      process.kill(pid, "SIGSTOP");
      try {
        await sleep(ms);
      } finally {
        process.kill(pid, "SIGCONT");
      }
    },
    stopServer,
    stop,
  };
}
