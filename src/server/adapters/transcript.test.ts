import test, { after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  isTranscriptPath,
  listConversations,
  projectsDirOf,
  readTranscriptTail,
  resolveTranscriptPath,
} from "./transcript.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "transcript-test-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const CWD = "/Users/someone/dispatch-workspaces/GROUP.9";
const projectDir = path.join(
  root,
  "projects",
  "-Users-someone-dispatch-workspaces-GROUP-9",
);
fs.mkdirSync(projectDir, { recursive: true });

const line = (entry: unknown) => JSON.stringify(entry) + "\n";
const assistant = (text: string) =>
  line({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
const user = (text: string) =>
  line({ type: "user", message: { role: "user", content: text } });

void test("a large transcript reports its full size and the last assistant text from the tail", async () => {
  const file = path.join(root, "large.jsonl");
  const filler = user("x".repeat(1000));
  fs.writeFileSync(
    file,
    assistant("old answer") + filler.repeat(400) + assistant("Shall I go on?"),
  );
  const tail = await readTranscriptTail(file);
  assert.equal(tail?.size, fs.statSync(file).size);
  assert.ok((tail?.size ?? 0) > 256 * 1024);
  assert.equal(tail?.lastAssistantText, "Shall I go on?");
  assert.ok((tail?.userTexts.length ?? 0) > 0);
  assert.ok(tail?.userTexts.every((t) => t === "x".repeat(1000)));
});

void test("an assistant entry outside the last 256 KiB is not read", async () => {
  const file = path.join(root, "old-only.jsonl");
  fs.writeFileSync(
    file,
    assistant("only answer") + user("y".repeat(1000)).repeat(400),
  );
  const tail = await readTranscriptTail(file);
  assert.equal(tail?.lastAssistantText, null);
});

void test("a missing transcript reads as null", async () => {
  assert.equal(await readTranscriptTail(path.join(root, "absent.jsonl")), null);
});

void test("the fallback order is the stored path, then the session id file, then the newest file", async () => {
  const named = path.join(projectDir, "sid-1.jsonl");
  const newest = path.join(projectDir, "other.jsonl");
  fs.writeFileSync(named, user("a"));
  fs.writeFileSync(newest, user("b"));
  fs.utimesSync(named, new Date(1_000_000), new Date(1_000_000));
  const stored = path.join(root, "stored.jsonl");
  fs.writeFileSync(stored, user("c"));
  const base = { configDir: root, cwd: CWD };

  assert.equal(
    await resolveTranscriptPath({ ...base, stored, claudeSessionId: "sid-1" }),
    stored,
  );
  assert.equal(
    await resolveTranscriptPath({
      ...base,
      stored: path.join(root, "gone.jsonl"),
      claudeSessionId: "sid-1",
    }),
    named,
  );
  assert.equal(
    await resolveTranscriptPath({ ...base, claudeSessionId: "sid-unknown" }),
    newest,
  );
  assert.equal(await resolveTranscriptPath(base), newest);
  assert.equal(
    await resolveTranscriptPath({ ...base, cwd: "/no/such/project" }),
    null,
  );
});

void test("a cwd with an underscore and a space resolves to the folder with both replaced by a dash", async () => {
  const dir = path.join(root, "projects", "-Users-some-one-my-repo-v2");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "only.jsonl");
  fs.writeFileSync(file, user("a"));
  assert.equal(
    await resolveTranscriptPath({
      configDir: root,
      cwd: "/Users/some_one/my repo/v2",
    }),
    file,
  );
});

void test("a hook transcript path must be an absolute .jsonl under a projects folder", () => {
  assert.equal(isTranscriptPath("/h/.claude/projects/-w/abc.jsonl"), true);
  assert.equal(isTranscriptPath("h/.claude/projects/-w/abc.jsonl"), false);
  assert.equal(isTranscriptPath("/h/.claude/projects/-w/abc.json"), false);
  assert.equal(isTranscriptPath("/h/.claude/other/-w/abc.jsonl"), false);
  assert.equal(isTranscriptPath("/h/.claude/projects/abc.jsonl"), false);
  assert.equal(
    isTranscriptPath("/h/.claude/projects/-w/../../../etc/x.jsonl"),
    false,
  );
  assert.equal(isTranscriptPath(42), false);
});

void test("listConversations lists top level jsonl files by id and ignores nested ones", async () => {
  const dir = path.join(root, "conversations");
  fs.mkdirSync(path.join(dir, "sub"), { recursive: true });
  fs.writeFileSync(path.join(dir, "aaa.jsonl"), "");
  fs.writeFileSync(path.join(dir, "bbb.jsonl"), "");
  fs.writeFileSync(path.join(dir, "notes.txt"), "");
  fs.writeFileSync(path.join(dir, "sub", "nested.jsonl"), "");
  const found = await listConversations(dir);
  assert.deepEqual(found.map((c) => c.id).sort(), ["aaa", "bbb"]);
  assert.ok(found.every((c) => c.bornAtMs > 0));
});

void test("listConversations skips a file whose name is not a valid session id", async () => {
  const dir = path.join(root, "bad-names");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "good-1.jsonl"), "");
  fs.writeFileSync(path.join(dir, ".jsonl"), "");
  fs.writeFileSync(path.join(dir, "-x.jsonl"), "");
  assert.deepEqual(
    (await listConversations(dir)).map((c) => c.id),
    ["good-1"],
  );
});

void test("listConversations leaves out top level agent subagent transcripts", async () => {
  const dir = path.join(root, "agent-names");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "real-1.jsonl"), "");
  fs.writeFileSync(path.join(dir, "agent-a1b2c3.jsonl"), "");
  assert.deepEqual(
    (await listConversations(dir)).map((c) => c.id),
    ["real-1"],
  );
});

void test("listConversations of a missing folder is empty", async () => {
  assert.deepEqual(await listConversations(path.join(root, "nowhere")), []);
});

void test("listConversations falls back to the modified time only when the file system reports no birth time", async () => {
  const dir = path.join(root, "birth-times");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "no-birth.jsonl"), "");
  fs.writeFileSync(path.join(dir, "has-birth.jsonl"), "");
  const stats: Record<string, { birthtimeMs: number; mtimeMs: number }> = {
    "no-birth.jsonl": { birthtimeMs: 0, mtimeMs: 2_000 },
    "has-birth.jsonl": { birthtimeMs: 1_000, mtimeMs: 2_000 },
  };
  const stat = mock.method(fsp, "stat", (file: string) =>
    Promise.resolve({ isFile: () => true, ...stats[path.basename(file)] }),
  );
  try {
    const found = await listConversations(dir);
    const bornAt = Object.fromEntries(found.map((c) => [c.id, c.bornAtMs]));
    assert.deepEqual(bornAt, { "no-birth": 2_000, "has-birth": 1_000 });
  } finally {
    stat.mock.restore();
  }
});

void test("projectsDirOf encodes the working directory the way Claude Code does", () => {
  assert.equal(
    projectsDirOf("/cfg", "/Users/a.b/c_d"),
    path.join("/cfg", "projects", "-Users-a-b-c-d"),
  );
});
