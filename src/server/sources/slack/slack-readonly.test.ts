import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SLACK_READ_METHODS } from "./slack-api.js";

const SRC = fileURLToPath(new URL("../../../", import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const WRITE_PATTERNS = [
  /\bchat\.[a-zA-Z]/,
  /\breactions\.[a-zA-Z]/,
  /\bfiles\.(upload|delete)/,
  /\bpins\.(add|remove)/,
  /\bconversations\.(create|archive|unarchive|invite|kick|join|leave|rename|setTopic|setPurpose|mark|open|close)\b/,
  /\bstars\.(add|remove)/,
  /\bbookmarks\.[a-zA-Z]/,
  /\breminders\.[a-zA-Z]/,
  /\busers\.profile\.set/,
  /\busers\.setPresence/,
];

/** Every .ts and .tsx file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** The Slack write-method names a piece of source text mentions. */
function writeCalls(text: string): string[] {
  return WRITE_PATTERNS.flatMap((pattern) => {
    const hit = pattern.exec(text);
    return hit ? [hit[0]] : [];
  });
}

test("the Slack client allowlist holds only the six read methods", () => {
  assert.deepEqual([...SLACK_READ_METHODS].sort(), [
    "auth.test",
    "conversations.history",
    "conversations.info",
    "conversations.replies",
    "users.conversations",
    "users.info",
  ]);
  assert.ok(Object.isFrozen(SLACK_READ_METHODS));
});

test("the scanner is live: a Slack write method in source text is caught", () => {
  assert.deepEqual(writeCalls('slackGet(token, "chat.postMessage")'), [
    "chat.p",
  ]);
  assert.equal(writeCalls("reactions.add").length, 1);
  assert.equal(writeCalls("files.upload").length, 1);
  assert.equal(writeCalls("pins.add").length, 1);
  assert.equal(writeCalls("conversations.join").length, 1);
  assert.equal(writeCalls("bookmarks.add").length, 1);
  assert.equal(writeCalls("users.profile.set").length, 1);
  assert.equal(writeCalls("conversations.history").length, 0);
});

test("no source file under src names a Slack write method", () => {
  const offenders = sourceFiles(SRC)
    .filter((path) => path !== SELF)
    .flatMap((path) =>
      writeCalls(readFileSync(path, "utf8")).map(
        (hit) => `${relative(SRC, path)}: ${hit}`,
      ),
    );
  assert.deepEqual(offenders, []);
});

const SLACK_API_HOST = /slack\.com\/api\b/;

test("no file under src/web names a Slack API host", () => {
  assert.ok(SLACK_API_HOST.test("https://slack.com/api/chat.postMessage"));
  assert.ok(SLACK_API_HOST.test("https://api.slack.com/api/users.info"));
  assert.equal(SLACK_API_HOST.test("https://api.slack.com/apps"), false);
  const offenders = sourceFiles(join(SRC, "web"))
    .filter((path) => SLACK_API_HOST.test(readFileSync(path, "utf8")))
    .map((path) => relative(SRC, path));
  assert.deepEqual(offenders, []);
});
