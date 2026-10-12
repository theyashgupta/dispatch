import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readTranscriptConversation } from "./transcript.js";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "conversation-test-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const line = (entry: unknown) => JSON.stringify(entry) + "\n";
const at = (n: number) => `2026-10-11T10:0${n}:00.000Z`;
const user = (uuid: string, content: unknown, extra = {}) =>
  line({
    type: "user",
    uuid,
    timestamp: at(1),
    message: { role: "user", content },
    ...extra,
  });
const assistant = (uuid: string, content: unknown[]) =>
  line({
    type: "assistant",
    uuid,
    timestamp: at(2),
    message: { role: "assistant", content },
  });

function write(name: string, body: string): string {
  const file = path.join(root, name);
  fs.writeFileSync(file, body);
  return file;
}

void test("user and assistant text entries come back in order with their uuid, time and type", async () => {
  const file = write(
    "order.jsonl",
    user("u1", "Kickoff") +
      assistant("a1", [
        { type: "text", text: "First part." },
        { type: "text", text: "Second part." },
      ]) +
      user("u2", [{ type: "text", text: "A comment" }]),
  );
  const read = await readTranscriptConversation(file, 200, 8000);
  assert.deepEqual(read, {
    entries: [
      { id: "u1", at: at(1), type: "user", text: "Kickoff" },
      {
        id: "a1",
        at: at(2),
        type: "assistant",
        text: "First part.\nSecond part.",
      },
      { id: "u2", at: at(1), type: "user", text: "A comment" },
    ],
    truncated: false,
  });
});

void test("tool calls, tool results, thinking, meta, sidechain, other types and broken lines carry no message", async () => {
  const file = write(
    "noise.jsonl",
    assistant("a1", [
      {
        type: "tool_use",
        id: "t1",
        name: "list_cards",
        input: { secret: "x" },
      },
    ]) +
      user("u1", [
        { type: "tool_result", tool_use_id: "t1", content: "result text" },
      ]) +
      assistant("a2", [
        { type: "thinking", thinking: "private thought" },
        { type: "text", text: "Visible answer" },
      ]) +
      user("u2", "meta line", { isMeta: true }) +
      user("u3", "sidechain line", { isSidechain: true }) +
      line({ type: "summary", summary: "s" }) +
      "{not json\n" +
      user("u4", "Kept"),
  );
  const read = await readTranscriptConversation(file, 200, 8000);
  assert.deepEqual(
    read?.entries.map((e) => [e.id, e.text]),
    [
      ["a2", "Visible answer"],
      ["u4", "Kept"],
    ],
  );
});

void test("a long message is cut at the limit with a cut mark", async () => {
  const file = write("long.jsonl", user("u1", "x".repeat(9000)));
  const [entry] =
    (await readTranscriptConversation(file, 200, 8000))?.entries ?? [];
  assert.equal(entry?.text, `${"x".repeat(8000)}\n[cut at 8000 characters]`);
});

void test("a cut that splits an emoji drops the lone high surrogate", async () => {
  const file = write(
    "emoji.jsonl",
    user("u1", `${"x".repeat(7999)}\u{1F600}tail`),
  );
  const [entry] =
    (await readTranscriptConversation(file, 200, 8000))?.entries ?? [];
  assert.equal(entry?.text, `${"x".repeat(7999)}\n[cut at 8000 characters]`);
});

void test("the limit keeps the newest entries and marks the read truncated", async () => {
  const file = write(
    "limit.jsonl",
    user("u1", "one") + user("u2", "two") + user("u3", "three"),
  );
  const read = await readTranscriptConversation(file, 2, 8000);
  assert.deepEqual(
    read?.entries.map((e) => e.text),
    ["two", "three"],
  );
  assert.equal(read?.truncated, true);
});

void test("a transcript over the 256 KiB tail drops its partial first line and is truncated", async () => {
  const filler = user("f", "y".repeat(1000));
  const file = write(
    "big.jsonl",
    user("first", "Kickoff") + filler.repeat(300) + user("last", "Newest"),
  );
  const read = await readTranscriptConversation(file, 200, 8000);
  assert.equal(read?.truncated, true);
  assert.equal(
    read?.entries.some((e) => e.id === "first"),
    false,
  );
  assert.equal(read?.entries.at(-1)?.text, "Newest");
});

void test("an entry with no uuid or time gets its byte offset as id and a null time", async () => {
  const file = write(
    "bare.jsonl",
    line({ type: "user", message: { content: "bare" } }),
  );
  const [entry] =
    (await readTranscriptConversation(file, 200, 8000))?.entries ?? [];
  assert.equal(entry?.id, "offset-0");
  assert.equal(entry?.at, null);
});

void test("a missing file resolves null", async () => {
  assert.equal(
    await readTranscriptConversation(path.join(root, "gone.jsonl"), 200, 8000),
    null,
  );
});

void test("entries Claude Code writes for itself are skipped", async () => {
  const file = write(
    "synthetic.jsonl",
    user("c1", "<command-name>/clear</command-name>") +
      user("c2", "<local-command-stdout></local-command-stdout>") +
      user("c3", "[Request interrupted by user]") +
      user("c4", "Summary of the earlier conversation", {
        isCompactSummary: true,
      }) +
      user("c6", "<task-notification>done</task-notification>", {
        origin: { kind: "task-notification" },
      }) +
      user("c5", "A real comment", { origin: { kind: "human" } }),
  );
  const read = await readTranscriptConversation(file, 200, 8000);
  assert.deepEqual(
    read?.entries.map((e) => e.id),
    ["c5"],
  );
});

void test("the byte offset id of a later line stays the same when an earlier line is added before the window", async () => {
  const bare = (text: string) =>
    line({ type: "user", message: { content: text } });
  const file = write("offset.jsonl", bare("one") + bare("two"));
  const first = await readTranscriptConversation(file, 200, 8000);
  const second = bare("one").length;
  assert.deepEqual(
    first?.entries.map((e) => e.id),
    ["offset-0", `offset-${second}`],
  );
});
