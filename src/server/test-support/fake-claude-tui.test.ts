import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isolateEnv } from "./fixtures.js";
import { writeFakeClaudeTui } from "./fake-claude-tui.js";

const env = isolateEnv();
const { run, spawnPiped } = await import("../adapters/exec.js");
const { TMUX_SERVER_ARGS, capturePane, sendKeys, sendLiteral } =
  await import("../adapters/tmux.js");
const { resolveBinaryPath } = await import("../adapters/resolve-binary.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

after(async () => {
  await run("tmux", [...TMUX_SERVER_ARGS, "kill-server"]).catch(
    () => undefined,
  );
  env.cleanup();
});

async function until(
  done: () => boolean | Promise<boolean>,
  ms = 3000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await done()) && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 50));
}

function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

interface Pane {
  name: string;
  transcript: string;
  keyLog: string;
  screen: () => Promise<string>;
}

async function startPane(
  name: string,
  scenario: Record<string, unknown>,
): Promise<Pane> {
  const dir = fs.mkdtempSync(path.join(env.root, "pane-"));
  const transcript = path.join(dir, "transcript.jsonl");
  const keyLog = path.join(dir, "keys.jsonl");
  const scenarioFile = path.join(dir, "scenario.json");
  fs.writeFileSync(
    scenarioFile,
    JSON.stringify({
      transcriptPath: transcript,
      keyLogPath: keyLog,
      ...scenario,
    }),
  );
  const bin = writeFakeClaudeTui(dir);
  await run("tmux", [
    ...TMUX_SERVER_ARGS,
    "new-session",
    "-d",
    "-s",
    name,
    "-x",
    "80",
    "-y",
    "24",
    `FAKE_CLAUDE_SCENARIO='${scenarioFile}' '${bin}'`,
  ]);
  return { name, transcript, keyLog, screen: () => capturePane(name) };
}

async function stopPane(pane: Pane): Promise<void> {
  await run("tmux", [
    ...TMUX_SERVER_ARGS,
    "kill-session",
    "-t",
    pane.name,
  ]).catch(() => undefined);
}

async function type(pane: Pane, text: string): Promise<void> {
  await sendLiteral(pane.name, text);
  await sendKeys(pane.name, ["Enter"]);
}

void test("the fake claude paints the prompt and repaints when the scenario changes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-tui-"));
  const scenario = path.join(dir, "scenario.txt");
  fs.writeFileSync(scenario, "ROW-ONE-A\nROW-TWO-A");
  const bin = writeFakeClaudeTui(dir);
  const child = spawnPiped(bin, ["--ignored"], {
    env: { FAKE_CLAUDE_SCENARIO: scenario },
  });
  let out = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    out += chunk.toString();
  });
  try {
    await until(() => out.includes("ROW-TWO-A"));
    assert.ok(out.includes("❯ "));
    assert.ok(out.includes("ROW-ONE-A\nROW-TWO-A"));
    fs.writeFileSync(scenario, "ROW-ONE-B\nROW-TWO-B");
    await until(() => out.includes("ROW-TWO-B"));
    assert.ok(out.includes("ROW-ONE-B\nROW-TWO-B"));
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test(
  "in a tmux pane the fake shows the ready prompt and the status rows",
  { skip: !hasTmux, timeout: 5000 },
  async () => {
    const pane = await startPane("fake-ready", {
      statusRows: ["STATUS-ONE", "STATUS-TWO"],
    });
    try {
      await until(async () => (await pane.screen()).includes("STATUS-TWO"));
      const screen = await pane.screen();
      assert.ok(screen.includes("❯"));
      assert.ok(screen.includes("STATUS-ONE"));
      assert.ok(screen.includes("STATUS-TWO"));
    } finally {
      await stopPane(pane);
    }
  },
);

void test(
  "a typed line lands in the transcript as one user and one assistant entry",
  { skip: !hasTmux, timeout: 5000 },
  async () => {
    const pane = await startPane("fake-typed", { statusRows: ["a", "b"] });
    try {
      await until(async () => (await pane.screen()).includes("❯"));
      await type(pane, "hello fake");
      await until(() => readJsonl(pane.transcript).length >= 2);
      const entries = readJsonl(pane.transcript);
      assert.equal(entries.length, 2);
      assert.equal(entries[0]?.type, "user");
      assert.deepEqual(entries[0]?.message, {
        role: "user",
        content: "hello fake",
      });
      assert.equal(entries[1]?.type, "assistant");
      assert.deepEqual(entries[1]?.message, {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
      });
    } finally {
      await stopPane(pane);
    }
  },
);

void test(
  "Down then Enter in a dialog logs the second row and closes the dialog",
  { skip: !hasTmux, timeout: 5000 },
  async () => {
    const pane = await startPane("fake-dialog", {
      statusRows: ["a", "b"],
      dialog: { title: "Pick one", rows: ["first row", "second row"] },
    });
    try {
      await until(async () => (await pane.screen()).includes("second row"));
      assert.ok((await pane.screen()).includes("❯ first row"));
      await sendKeys(pane.name, ["Down"]);
      await until(async () => (await pane.screen()).includes("❯ second row"));
      await sendKeys(pane.name, ["Enter"]);
      await until(() => readJsonl(pane.keyLog).some((l) => l.key === "enter"));
      const log = readJsonl(pane.keyLog);
      assert.deepEqual(
        log.map((l) => [l.key, l.row]),
        [
          ["down", "second row"],
          ["enter", "second row"],
        ],
      );
      await until(async () => !(await pane.screen()).includes("Pick one"));
      assert.ok(!(await pane.screen()).includes("Pick one"));
    } finally {
      await stopPane(pane);
    }
  },
);

void test(
  "while warming up the fake shows the status and ignores typed input",
  { skip: !hasTmux, timeout: 5000 },
  async () => {
    const pane = await startPane("fake-warm", {
      statusRows: ["STATUS-ONE", "STATUS-TWO"],
      warmingUpMs: 1500,
    });
    try {
      await until(async () => (await pane.screen()).includes("warming up"));
      assert.ok((await pane.screen()).includes("warming up"));
      await type(pane, "too early");
      await until(async () => !(await pane.screen()).includes("warming up"));
      assert.ok((await pane.screen()).includes("STATUS-ONE"));
      assert.deepEqual(readJsonl(pane.transcript), []);
      await type(pane, "on time");
      await until(() => readJsonl(pane.transcript).length >= 2);
      const entries = readJsonl(pane.transcript);
      assert.equal(entries.length, 2);
      assert.deepEqual(entries[0]?.message, {
        role: "user",
        content: "on time",
      });
    } finally {
      await stopPane(pane);
    }
  },
);
