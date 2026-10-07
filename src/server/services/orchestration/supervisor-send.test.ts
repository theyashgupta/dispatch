import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import { writeFakeClaudeTui } from "../../test-support/fake-claude-tui.js";
import type {
  Card,
  OrchestrationEvent,
  Session,
} from "../../../shared/types.js";

const env = isolateEnv();
const { run } = await import("../../adapters/exec.js");
const { TMUX_SERVER_ARGS } = await import("../../adapters/tmux.js");
const { resolveBinaryPath } = await import("../../adapters/resolve-binary.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { fakeBoardRepository } =
  await import("../../test-support/fake-board-repository.js");
const { sendConfirmed } = await import("./supervisor-send.js");
const hasTmux = (await resolveBinaryPath("tmux")) !== null;

const events: Omit<OrchestrationEvent, "id">[] = [];
setBoardRepository(
  fakeBoardRepository({
    appendOrchestrationEvent: (e) => {
      events.push(e);
      return { ...e, id: events.length };
    },
  }),
);

after(async () => {
  await run("tmux", [...TMUX_SERVER_ARGS, "kill-server"]).catch(
    () => undefined,
  );
  env.cleanup();
});

const FAST = { readyMs: 2_000, settleMs: 300, confirmMs: 1_500, pollMs: 100 };
const WARMING_ROW = "│  ░░░  warming up";

interface Pane {
  card: Card;
  session: Session;
  transcript: string;
  keyLog: string;
  root: string;
}

function readJsonl(file: string): Record<string, unknown>[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const userTexts = (pane: Pane) =>
  readJsonl(pane.transcript)
    .filter((e) => e.type === "user")
    .map((e) => (e.message as { content: string }).content);

async function startPane(
  name: string,
  scenario: Record<string, unknown>,
  writes = true,
): Promise<Pane> {
  const root = fs.mkdtempSync(path.join(env.root, `${name}-`));
  const transcript = path.join(root, "transcript.jsonl");
  fs.writeFileSync(transcript, "");
  const keyLog = path.join(root, "keys.jsonl");
  const scenarioFile = path.join(root, "scenario.json");
  fs.writeFileSync(
    scenarioFile,
    JSON.stringify({
      ...(writes ? { transcriptPath: transcript } : {}),
      keyLogPath: keyLog,
      logAllKeys: true,
      statusRows: ["  ⏵⏵ accept edits on"],
      ...scenario,
    }),
  );
  const bin = writeFakeClaudeTui(root);
  await run("tmux", [
    ...TMUX_SERVER_ARGS,
    "new-session",
    "-d",
    "-s",
    name,
    "-x",
    "120",
    "-y",
    "30",
    `FAKE_CLAUDE_SCENARIO='${scenarioFile}' '${bin}'`,
  ]);
  const session = {
    id: `${name}-session`,
    createdAt: "",
    updatedAt: "",
    tmuxSession: name,
    transcriptPath: transcript,
    workspace: { folder: root, repos: [] },
  } as Session;
  const card = {
    id: `${name}-card`,
    workspacePath: root,
    sessions: [session],
  } as unknown as Card;
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { card, session, transcript, keyLog, root };
}

const enters = (pane: Pane) =>
  readJsonl(pane.keyLog).filter((k) => k.key === "enter").length;

void test(
  "a short line is confirmed and appears once in the transcript",
  { skip: !hasTmux },
  async () => {
    const pane = await startPane("send-short", {});
    const result = await sendConfirmed(
      pane.card,
      pane.session,
      "run the next phase",
      "continue",
      FAST,
    );
    assert.equal(result, "confirmed");
    assert.deepEqual(userTexts(pane), ["run the next phase"]);
    assert.equal(enters(pane), 1);
  },
);

void test(
  "a dropped first Enter is confirmed after the one retry Enter",
  { skip: !hasTmux },
  async () => {
    const pane = await startPane("send-drop", { dropEnters: 1 });
    const result = await sendConfirmed(
      pane.card,
      pane.session,
      "resume the loop",
      "continue",
      FAST,
    );
    assert.equal(result, "confirmed");
    assert.deepEqual(userTexts(pane), ["resume the loop"]);
    assert.equal(enters(pane), 2);
  },
);

void test(
  "a send the transcript never shows is retried once and reported as one event",
  { skip: !hasTmux },
  async () => {
    const before = events.length;
    const pane = await startPane("send-lost", {}, false);
    const result = await sendConfirmed(
      pane.card,
      pane.session,
      "are you there",
      "continue",
      FAST,
    );
    assert.equal(result, "unconfirmed");
    assert.equal(enters(pane), 2);
    const added = events.slice(before);
    assert.equal(added.length, 1);
    assert.equal(added[0].kind, "supervisor_action");
    assert.equal(added[0].data.result, "unconfirmed");
    assert.equal(added[0].sessionId, pane.session.id);
  },
);

void test(
  "a text over 500 characters is written to a file and sent as a one line pointer",
  { skip: !hasTmux },
  async () => {
    const pane = await startPane("send-long", {});
    const text = "Long brief. ".repeat(50);
    assert.ok(text.length > 500);
    const result = await sendConfirmed(
      pane.card,
      pane.session,
      text,
      "handoff",
      FAST,
    );
    assert.equal(result, "confirmed");
    const dir = path.join(pane.root, ".dispatch-input");
    const files = fs.readdirSync(dir);
    assert.equal(files.length, 1);
    assert.match(files[0], /-handoff\.md$/);
    assert.equal(fs.readFileSync(path.join(dir, files[0]), "utf8"), text);
    const sent = userTexts(pane);
    assert.equal(sent.length, 1);
    assert.ok(sent[0].includes(path.join(dir, files[0])));
    assert.ok(sent[0].length < 500);
  },
);

void test(
  "no key is sent while the session stays warming up",
  { skip: !hasTmux },
  async () => {
    const before = events.length;
    const pane = await startPane("send-warm", { statusRows: [WARMING_ROW] });
    const result = await sendConfirmed(
      pane.card,
      pane.session,
      "hello",
      "continue",
      FAST,
    );
    assert.equal(result, "unconfirmed");
    assert.deepEqual(readJsonl(pane.keyLog), []);
    assert.deepEqual(userTexts(pane), []);
    assert.equal(events.length, before + 1);
    assert.equal(events.at(-1)?.data.reason, "not ready");
  },
);

void test(
  "the keys reach only the exact session name, never a session whose name extends it",
  { skip: !hasTmux },
  async () => {
    const longer = await startPane("send-prefix", {});
    const missing = {
      ...longer.session,
      id: "send-pre-session",
      tmuxSession: "send-pre",
    } as Session;
    const result = await sendConfirmed(
      longer.card,
      missing,
      "not for prefix",
      "continue",
      FAST,
    );
    assert.equal(result, "unconfirmed");
    assert.deepEqual(readJsonl(longer.keyLog), []);
    assert.deepEqual(userTexts(longer), []);
  },
);

void test(
  "a pointer line is confirmed in a new transcript although the old one holds a pointer with the same first 80 characters",
  { skip: !hasTmux },
  async () => {
    const pane = await startPane(`send-clear-${"r".repeat(60)}`, {});
    const dir = path.join(pane.root, ".dispatch-input");
    const old = path.join(pane.root, "old.jsonl");
    fs.writeFileSync(
      old,
      `${JSON.stringify({
        type: "user",
        message: {
          content: `Read ${dir}/2026-01-01T00-00-00-000Z-handoff.md and follow it.`,
        },
      })}\n`,
    );
    let reads = 0;
    const transcriptOf = () =>
      Promise.resolve(reads++ === 0 ? old : pane.transcript);
    const result = await sendConfirmed(
      pane.card,
      pane.session,
      "Resume brief. ".repeat(50),
      "resume",
      FAST,
      transcriptOf,
    );
    assert.equal(result, "confirmed");
    assert.equal(enters(pane), 1);
  },
);

void test(
  "control characters in the text become single spaces and one Enter is sent",
  { skip: !hasTmux },
  async () => {
    const pane = await startPane("send-control", {});
    const result = await sendConfirmed(
      pane.card,
      pane.session,
      "go\r\u001bon",
      "continue",
      FAST,
    );
    assert.equal(result, "confirmed");
    assert.deepEqual(userTexts(pane), ["go on"]);
    assert.doesNotMatch(userTexts(pane)[0], /\p{Cc}/u);
    assert.equal(enters(pane), 1);
  },
);

void test(
  "no key is sent while a usage limit menu is open",
  { skip: !hasTmux },
  async () => {
    const before = events.length;
    const pane = await startPane("send-dialog", {
      prompt: "",
      transcript: ["❯ /rate-limit-options"],
      dialog: {
        title: "What do you want to do?",
        rows: [
          "1. Stop and wait for limit to reset",
          "2. Wait here, then continue automatically at 8:30am",
          "3. Switch to usage credits",
        ],
        cursor: 0,
      },
    });
    const result = await sendConfirmed(
      pane.card,
      pane.session,
      "hello",
      "continue",
      FAST,
    );
    assert.equal(result, "unconfirmed");
    assert.deepEqual(readJsonl(pane.keyLog), []);
    assert.deepEqual(userTexts(pane), []);
    assert.equal(events.length, before + 1);
    assert.equal(events.at(-1)?.data.reason, "not ready");
  },
);

void test(
  "a text that starts with a hyphen or ends with a semicolon is typed exactly as written",
  { skip: !hasTmux },
  async () => {
    const texts = ["- pick the second option", "-1", "hello;", "a\\;", ";"];
    for (const [i, text] of texts.entries()) {
      const pane = await startPane(`send-literal-${i}`, {});
      const result = await sendConfirmed(
        pane.card,
        pane.session,
        text,
        "continue",
        FAST,
      );
      assert.equal(result, "confirmed", text);
      assert.deepEqual(userTexts(pane), [text]);
      assert.equal(enters(pane), 1, text);
    }
  },
);

void test(
  "a text ending in two semicolons is typed exactly as written",
  { skip: !hasTmux },
  async () => {
    const texts = ["run a;;", ";;", "a;\\;;"];
    for (const [i, text] of texts.entries()) {
      const pane = await startPane(`send-double-semicolon-${i}`, {});
      const result = await sendConfirmed(
        pane.card,
        pane.session,
        text,
        "continue",
        FAST,
      );
      assert.equal(result, "confirmed", text);
      assert.deepEqual(userTexts(pane), [text]);
      assert.equal(enters(pane), 1, text);
    }
  },
);
