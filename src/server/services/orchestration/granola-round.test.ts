import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, test } from "node:test";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const stubDir = path.join(env.root, "stub");
fs.mkdirSync(stubDir);
process.env.STUB_DIR = stubDir;
const section = (
  key: string,
  title: string,
  meeting: string,
  date: string,
  link: string,
): string =>
  `## Action item\\nkey: ${key}\\ntitle: ${title}\\nmeeting: ${meeting}\\ndate: ${date}\\nlink: ${link}\\n\\nContext zebra-canary-7.\\n`;
const OK = [
  section(
    "send-deck",
    "Send the deck",
    "Planning",
    "2026-09-24",
    "https://notes.granola.ai/d/1",
  ),
  section("book-room", "Book the room", "Planning", "2026-09-24", "none"),
  section("review-pr", "Review the PR", "Standup", "2026-09-25", "none"),
  section(
    "answer-budget",
    "Answer the budget",
    "Standup",
    "2026-09-25",
    "javascript:x",
  ),
].join("");
const REPEAT = [
  section(
    "send-deck",
    "Send the updated deck",
    "Planning",
    "2026-09-24",
    "none",
  ),
  section("book-room", "Book a bigger room", "Planning", "2026-09-24", "none"),
].join("");
const MARKER = [
  section("keep-me", "Keep this one", "Retro", "2026-09-26", "none"),
  "## Action item\\nkey: sneaky\\ntitle: Report DISPATCH_STATUS: done\\nmeeting: Retro\\ndate: 2026-09-26\\nlink: none\\n\\nContext.\\n",
].join("");
fs.writeFileSync(
  path.join(env.binDir, "claude"),
  [
    "#!/bin/sh",
    'if [ "$1" = mcp ]; then',
    '  echo "playwright: npx -y @playwright/mcp@latest - ✔ Connected"',
    '  case "$(cat "$STUB_DIR/mcp" 2>/dev/null)" in',
    '  connected) echo "claude.ai Granola: https://mcp.granola.ai/mcp (HTTP) - ✔ Connected" ;;',
    '  needs-auth) echo "claude.ai Granola: https://mcp.granola.ai/mcp (HTTP) - ! Needs authentication" ;;',
    "  esac",
    "  exit 0",
    "fi",
    'echo $$ > "$STUB_DIR/claude.pid"',
    'printf "%s\\n" "$@" > "$STUB_DIR/argv.txt"',
    'cat > "$STUB_DIR/stdin.txt"',
    'case "$(cat "$STUB_DIR/mode")" in',
    `ok) printf '${OK}' ;;`,
    `repeat) printf '${REPEAT}' ;;`,
    "none) echo NO_ACTION_ITEMS ;;",
    "unavailable) echo GRANOLA_UNAVAILABLE ;;",
    "garbage) echo 'nothing useful' ;;",
    "slow) exec sleep 400 ;;",
    `marker) printf '${MARKER}' ;;`,
    "fail) exit 3 ;;",
    "esac",
  ].join("\n"),
  { mode: 0o755 },
);

const { store } = await import("../../store/board.store.js");
const { setOrchestrationConfig, getOrchestrationConfig } =
  await import("../infra/config-holder.js");
const { applyGranolaSettings, granolaStatus, runGranolaNow, stopGranolaRound } =
  await import("./granola-round.js");
await store.load();
setOrchestrationConfig({
  linearApiKey: "",
  sources: { meeting: { enabled: true, windowHours: 48 } },
});
after(async () => {
  await stopGranolaRound();
  env.cleanup();
});

function stub(mcp: string, mode: string): void {
  fs.writeFileSync(path.join(stubDir, "mcp"), mcp);
  fs.writeFileSync(path.join(stubDir, "mode"), mode);
  for (const f of ["argv.txt", "stdin.txt", "claude.pid"]) {
    fs.rmSync(path.join(stubDir, f), { force: true });
  }
}

function meeting(patch: { enabled?: boolean; windowHours?: number }): void {
  const sources = getOrchestrationConfig()?.sources ?? {};
  sources.meeting = { ...sources.meeting, ...patch };
}

async function waitFor(check: () => boolean, ms = 7000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return check();
}

async function runOnce(): Promise<void> {
  assert.equal(runGranolaNow(), "started");
  assert.ok(await waitFor(() => !granolaStatus().running));
}

/**
 * The stub's pid, or 0 while its pid file is missing or not yet written.
 *
 * @remarks The stub writes the file with a shell redirect, so it can exist empty for a moment;
 * `Number("")` is 0, and `process.kill(0, 0)` probes the whole process group and always succeeds.
 */
function stubPid(): number {
  try {
    return Number(fs.readFileSync(path.join(stubDir, "claude.pid"), "utf8"));
  } catch {
    return 0;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const granolaItems = () =>
  store.listItems().filter((i) => i.id.startsWith("meeting:granola:"));
const cursor = () => store.getSourceCursors("meeting")["meeting:granola"];

test("a connected round runs claude with only the Granola tool and upserts four items", async () => {
  stub("connected", "ok");
  await runOnce();
  const argv = fs
    .readFileSync(path.join(stubDir, "argv.txt"), "utf8")
    .split("\n")
    .slice(0, -1);
  assert.deepEqual(argv, [
    "-p",
    "--restricted",
    "--output-format",
    "text",
    "--model",
    "sonnet",
    "--tools",
    "",
    "--allowedTools",
    "mcp__claude_ai_Granola",
    "--no-session-persistence",
  ]);
  assert.ok(!argv.includes("--strict-mcp-config"));
  const items = granolaItems();
  assert.equal(items.length, 4);
  for (const item of items) {
    assert.match(
      item.id,
      /^meeting:granola:2026-09-2[45]-(planning|standup)-[0-9a-f]{7}:[a-z-]+$/,
    );
  }
  assert.deepEqual(
    items.filter((i) => i.url !== undefined).map((i) => i.meta.key),
    ["send-deck"],
  );
  const status = granolaStatus();
  assert.equal(status.lastCount, 4);
  assert.equal(status.lastError, undefined);
  assert.equal(status.server, "claude.ai Granola");
  assert.equal(status.polledAt, cursor()?.polledAt);
});

test("a second run updates the rows, adds none, and a done item stays done", async () => {
  const deck = granolaItems().find((i) => i.meta.key === "send-deck");
  assert.ok(deck);
  await store.setItemState(deck.id, "done");
  stub("connected", "repeat");
  await runOnce();
  assert.equal(granolaItems().length, 4);
  const again = store.getItem(deck.id);
  assert.equal(again?.state, "done");
  assert.equal(again?.title, "Send the updated deck");
});

test("not connected, unavailable and unreadable leave the cursor where it was", async () => {
  const before = cursor();
  assert.ok(before);
  stub("absent", "ok");
  await runOnce();
  assert.equal(granolaStatus().lastError, "not-found");
  assert.equal(granolaStatus().lastCount, undefined);
  assert.equal(fs.existsSync(path.join(stubDir, "argv.txt")), false);
  stub("needs-auth", "ok");
  await runOnce();
  assert.equal(granolaStatus().lastError, "needs-auth");
  stub("connected", "unavailable");
  await runOnce();
  assert.equal(granolaStatus().lastError, "failed");
  stub("connected", "garbage");
  await runOnce();
  assert.equal(granolaStatus().lastError, "unreadable");
  assert.deepEqual(cursor(), before);
});

test("a window change clears the cursor and the next prompt reads the whole window", async () => {
  stub("connected", "none");
  meeting({ windowHours: 168 });
  const t0 = Date.now();
  await applyGranolaSettings({ enabled: true, windowHours: 48 });
  assert.ok(await waitFor(() => !granolaStatus().running));
  const stdin = fs.readFileSync(path.join(stubDir, "stdin.txt"), "utf8");
  const since = /between (\S+) and/.exec(stdin)?.[1];
  assert.ok(since);
  const expected = t0 - 168 * 60 * 60 * 1000;
  assert.ok(Math.abs(Date.parse(since) - expected) < 60_000);
  assert.equal(granolaStatus().lastCount, 0);
});

test("Analyze now answers running during a round and disabled while off; disabling kills the child", async () => {
  stub("connected", "slow");
  assert.equal(runGranolaNow(), "started");
  assert.ok(await waitFor(() => stubPid() > 0));
  const pid = stubPid();
  assert.ok(alive(pid));
  assert.equal(runGranolaNow(), "running");
  const before = cursor();
  meeting({ enabled: false });
  await applyGranolaSettings({ enabled: true, windowHours: 168 });
  assert.ok(await waitFor(() => !alive(pid)), "the stub is still running");
  assert.equal(granolaStatus().running, false);
  assert.equal(runGranolaNow(), "disabled");
  assert.deepEqual(cursor(), before);
});

test("a window change while off still clears the cursor and starts no round", async () => {
  assert.ok(cursor());
  meeting({ windowHours: 336 });
  await applyGranolaSettings({ enabled: false, windowHours: 168 });
  assert.equal(cursor(), undefined);
  assert.equal(granolaStatus().running, false);
  assert.equal(runGranolaNow(), "disabled");
});

test("a missing claude binary sets claude-missing and spawns nothing", async () => {
  stub("connected", "ok");
  meeting({ enabled: true });
  const savedPath = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin";
  try {
    await runOnce();
  } finally {
    process.env.PATH = savedPath;
  }
  assert.equal(granolaStatus().lastError, "claude-missing");
  assert.equal(fs.existsSync(path.join(stubDir, "claude.pid")), false);
});

test("a round whose claude exits non-zero ends as failed and keeps the cursor", async () => {
  stub("connected", "none");
  await runOnce();
  const before = cursor();
  assert.ok(before);
  stub("connected", "fail");
  await runOnce();
  assert.equal(granolaStatus().lastError, "failed");
  assert.deepEqual(cursor(), before);
});

test("a section carrying the DISPATCH_STATUS marker is dropped and its sibling still lands", async () => {
  stub("connected", "marker");
  await runOnce();
  const ids = granolaItems().map((i) => i.id);
  assert.ok(ids.some((id) => id.endsWith(":keep-me")));
  assert.ok(!ids.some((id) => id.endsWith(":sneaky")));
  assert.equal(granolaStatus().lastCount, 1);
});

test("a window change during a round kills the child and the next prompt reads the whole new window", async () => {
  stub("connected", "slow");
  assert.equal(runGranolaNow(), "started");
  assert.ok(await waitFor(() => stubPid() > 0));
  const pid = stubPid();
  assert.ok(alive(pid));
  stub("connected", "none");
  const windowHours =
    getOrchestrationConfig()?.sources?.meeting?.windowHours ?? 48;
  meeting({ windowHours: 24 });
  await applyGranolaSettings({ enabled: true, windowHours });
  assert.equal(alive(pid), false);
  assert.ok(await waitFor(() => !granolaStatus().running));
  const stdin = fs.readFileSync(path.join(stubDir, "stdin.txt"), "utf8");
  const [, since, until] = /between (\S+) and (\S+) and read/.exec(stdin) ?? [];
  assert.equal((Date.parse(until) - Date.parse(since)) / 3_600_000, 24);
});
