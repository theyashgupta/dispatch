import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isTranscriptPath,
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
