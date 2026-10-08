import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../../test-support/fixtures.js";
import type { Card, Session } from "../../../shared/types.js";

const env = isolateEnv();
const { sessionTranscriptPath } = await import("./supervisor-transcript.js");

after(() => env.cleanup());

const project = (cwd: string) =>
  path.join(env.home, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));

function write(file: string, mtime: number): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  fs.utimesSync(file, mtime, mtime);
  return file;
}

function subject(name: string, over: Partial<Session> = {}) {
  const cwd = path.join(env.root, "work.space", name);
  const session = {
    id: `${name}-session`,
    workspacePath: cwd,
    workspace: { folder: "/source/folder", repos: [] },
    ...over,
  } as Session;
  return {
    card: { id: name, workspacePath: "/elsewhere" } as Card,
    session,
    cwd,
  };
}

void test("the stored transcript path wins when the file exists", async () => {
  const { card, session, cwd } = subject("stored");
  const stored = write(path.join(env.root, "stored-elsewhere.jsonl"), 1_000);
  write(path.join(project(cwd), "other.jsonl"), 2_000);
  session.transcriptPath = stored;
  assert.equal(await sessionTranscriptPath(card, session), stored);
});

void test("a stored path whose file is gone falls back to the file named by the Claude session id", async () => {
  const { card, session, cwd } = subject("named", {
    transcriptPath: path.join(env.root, "gone.jsonl"),
    claudeSessionId: "conv-abc",
  });
  const named = write(path.join(project(cwd), "conv-abc.jsonl"), 1_000);
  write(path.join(project(cwd), "newer.jsonl"), 2_000);
  assert.equal(await sessionTranscriptPath(card, session), named);
});

void test("without a stored path or a named file the newest jsonl of the project folder is used", async () => {
  const { card, session, cwd } = subject("newest", {
    claudeSessionId: "missing",
  });
  write(path.join(project(cwd), "old.jsonl"), 1_000);
  const newest = write(path.join(project(cwd), "new.jsonl"), 2_000);
  write(path.join(project(cwd), "notes.txt"), 3_000);
  assert.equal(await sessionTranscriptPath(card, session), newest);
});

void test("the card workspace path names the project folder when the session has no workspace", async () => {
  const { cwd } = subject("card-cwd");
  const only = write(path.join(project(cwd), "only.jsonl"), 1_000);
  const card = { id: "card-cwd", workspacePath: cwd } as Card;
  assert.equal(await sessionTranscriptPath(card, { id: "s" } as Session), only);
});

void test("a project folder with no transcript gives null", async () => {
  const { card, session } = subject("empty");
  assert.equal(await sessionTranscriptPath(card, session), null);
});
