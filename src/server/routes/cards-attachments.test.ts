import assert from "node:assert/strict";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, mock, test } from "node:test";
import express from "express";
import type { Server } from "node:http";
import type { Card } from "../../shared/types.js";

process.env.HOME = await fsp.mkdtemp(path.join(os.tmpdir(), "dsp-att-"));
const { cardsRouter } = await import("./cards.route.js");
const { store } = await import("../store/board.store.js");
const { attachmentsDir } = await import("../services/infra/paths.js");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 7),
]).toString("base64");
const TEXT = Buffer.from("not an image at all").toString("base64");

let server: Server;
let base = "";
let created: { title: string; description: string }[] = [];
let nextId = 0;

before(async () => {
  mock.method(
    store,
    "createLocalCard",
    (title: string, description: string) => {
      created.push({ title, description });
      nextId += 1;
      return Promise.resolve({
        id: `LOCAL-${nextId}`,
        issueId: `LOCAL-${nextId}`,
        identifier: `LOCAL-${nextId}`,
        title,
        description,
        priority: 0,
        column: "todo",
        updatedAt: "",
        source: "local",
      } as Card);
    },
  );
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

async function create(body: unknown): Promise<Response> {
  created = [];
  return fetch(`${base}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("create with one PNG stores the file and appends the Screenshots section", async () => {
  const res = await create({ title: "t", description: "d", images: [PNG] });
  assert.equal(res.status, 201);
  const card = (await res.json()) as Card;
  assert.match(
    card.description ?? "",
    /^d\n\n## Screenshots\n\n!\[screenshot 1\]\(attachments\/[a-f0-9]{16}\.png\)$/,
  );
  const name = /attachments\/([^)]+)\)/.exec(card.description ?? "")?.[1] ?? "";
  const bytes = await fsp.readFile(path.join(attachmentsDir(card.id), name));
  assert.equal(bytes.toString("base64"), PNG);
});

test("create without images leaves the description untouched and writes no folder", async () => {
  const res = await create({ title: "t", description: "plain" });
  assert.equal(res.status, 201);
  assert.equal(created[0]?.description, "plain");
  const card = (await res.json()) as Card;
  await assert.rejects(fsp.stat(attachmentsDir(card.id)));
});

test("create rejects eleven images, a non-image, and an oversize image without creating a card", async () => {
  for (const images of [
    Array.from({ length: 11 }, () => PNG),
    [TEXT],
    ["A".repeat(15 * 1024 * 1024)],
  ]) {
    const res = await create({ title: "t", description: "d", images });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "invalid-images" });
    assert.equal(created.length, 0);
  }
});

test("create rejects a description that only overflows the cap once the links are appended", async () => {
  const res = await create({
    title: "t",
    description: "d".repeat(20000),
    images: [PNG],
  });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "invalid-description" });
  assert.equal(created.length, 0);
});

test("create answers a JSON 500 and mints no card when the attachment root cannot be written", async () => {
  const root = path.dirname(attachmentsDir("x"));
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.writeFile(root, "not a directory");
  try {
    const res = await create({ title: "t", description: "d", images: [PNG] });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "attachment-write-failed" });
    assert.equal(created.length, 0);
  } finally {
    await fsp.rm(root, { force: true });
  }
});

test("attachment route serves a stored file and rejects bad names", async () => {
  const dir = attachmentsDir("LOCAL-9");
  await fsp.mkdir(dir, { recursive: true });
  const name = "0123456789abcdef.png";
  await fsp.writeFile(path.join(dir, name), Buffer.from(PNG, "base64"));

  const ok = await fetch(`${base}/cards/LOCAL-9/attachments/${name}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("content-type"), "image/png");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.equal(ok.headers.get("content-security-policy"), "sandbox");
  assert.equal(Buffer.from(await ok.arrayBuffer()).toString("base64"), PNG);

  assert.equal(
    (await fetch(`${base}/cards/LOCAL-9/attachments/${"f".repeat(16)}.png`))
      .status,
    404,
  );
  assert.equal(
    (await fetch(`${base}/cards/LOCAL-9/attachments/..%2Fboard.db`)).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/cards/LOCAL-9/attachments/notes.txt`)).status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/cards/..%2FLOCAL-9/attachments/${name}`)).status,
    400,
  );
});
