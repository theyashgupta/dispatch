import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import express from "express";
import type { Server } from "node:http";

const home = await fsp.mkdtemp(path.join(os.tmpdir(), "dsp-draft-"));
process.env.HOME = home;
const binDir = path.join(home, "bin");
const argvFile = path.join(home, "claude-argv.txt");
const stdinFile = path.join(home, "claude-stdin.txt");
process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
process.env.FAKE_CLAUDE_ARGV = argvFile;
process.env.FAKE_CLAUDE_STDIN = stdinFile;
await fsp.mkdir(binDir, { recursive: true });
await fsp.mkdir(path.join(home, ".dispatch"));
await fsp.writeFile(
  path.join(binDir, "claude"),
  [
    "#!/bin/sh",
    'printf "%s\\n" "$@" > "$FAKE_CLAUDE_ARGV"',
    'case "$2" in',
    `--*) cat > "$FAKE_CLAUDE_STDIN"; printf '%s\\n' '{"type":"result","result":"## Title\\nFake title\\n\\n## Description\\nFake description"}' ;;`,
    `*) : > "$FAKE_CLAUDE_STDIN"; printf '## Title\\nFake title\\n\\n## Description\\nFake description\\n' ;;`,
    "esac",
  ].join("\n"),
  { mode: 0o755 },
);

const { cardsRouter } = await import("./cards.route.js");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 9),
]).toString("base64");
const TEXT = Buffer.from("not an image at all").toString("base64");

let server: Server;
let base = "";

before(async () => {
  const app = express();
  app.use("/api", express.json({ limit: "150mb" }), cardsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  base = `http://127.0.0.1:${addr.port}/api`;
});

after(() => {
  server.close();
});

async function draft(body: unknown): Promise<Response> {
  await fsp.rm(argvFile, { force: true });
  await fsp.rm(stdinFile, { force: true });
  return fetch(`${base}/cards/draft`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("draft rejects eleven images, a non-image, and an oversize image before any spawn", async () => {
  for (const images of [
    Array.from({ length: 11 }, () => PNG),
    [TEXT],
    ["A".repeat(15 * 1024 * 1024)],
  ]) {
    const res = await draft({ direction: "fix the button", images });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "invalid-images" });
    await assert.rejects(fsp.stat(argvFile));
  }
});

test("draft with images spawns claude in stream-json mode with the image block on stdin", async () => {
  const res = await draft({ direction: "fix the button", images: [PNG] });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    title: "Fake title",
    description: "Fake description",
  });
  const argv = (await fsp.readFile(argvFile, "utf8")).split("\n");
  assert.ok(argv.includes("--input-format"));
  assert.ok(argv.includes("--verbose"));
  assert.ok(argv.includes("--tools"));
  const msg = JSON.parse(await fsp.readFile(stdinFile, "utf8")) as {
    message: {
      content: { type: string; text?: string; source?: { data: string } }[];
    };
  };
  assert.equal(msg.message.content[0].type, "text");
  assert.ok(msg.message.content[0].text?.includes("fix the button"));
  assert.equal(msg.message.content[1].type, "image");
  assert.equal(msg.message.content[1].source?.data, PNG);
});

test("draft without images keeps the text-mode invocation", async () => {
  const res = await draft({ direction: "fix the button" });
  assert.equal(res.status, 200);
  const argv = await fsp.readFile(argvFile, "utf8");
  assert.ok(argv.startsWith("-p\n"));
  assert.ok(argv.includes("fix the button"));
  assert.ok(!argv.includes("--input-format"));
  assert.equal(await fsp.readFile(stdinFile, "utf8"), "");
});
