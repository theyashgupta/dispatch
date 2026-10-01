import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import express from "express";
import { httpErrorHandler } from "./error-handler.js";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  UpstreamError,
  ValidationError,
} from "../services/domain/errors.js";

const app = express();
app.set("env", "test");
app.use(express.json());
app.get("/validation", () => {
  throw new ValidationError("invalid-name");
});
app.get("/not-found", () => {
  throw new NotFoundError("not-found");
});
app.get("/conflict", () => {
  throw new ConflictError("name-exists", {
    variant: "config",
    error: "ignored",
  });
});
app.get("/upstream", async () => {
  await Promise.resolve();
  throw new UpstreamError("generate-failed");
});
app.get("/internal", () => {
  throw new InternalError("playbook-write-failed");
});
app.get("/plain", () => {
  throw new Error("secret stack detail");
});
app.post("/echo", (req, res) => {
  res.json(req.body);
});
app.use(httpErrorHandler);

const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => server.close());

const cases: [string, number, string][] = [
  ["/validation", 400, '{"error":"invalid-name"}'],
  ["/not-found", 404, '{"error":"not-found"}'],
  ["/conflict", 409, '{"error":"name-exists","variant":"config"}'],
  ["/upstream", 502, '{"error":"generate-failed"}'],
  ["/internal", 500, '{"error":"playbook-write-failed"}'],
];

for (const [route, status, body] of cases) {
  test(`${route} answers ${status} with the exact body`, async () => {
    const res = await fetch(base + route);
    assert.equal(res.status, status);
    assert.equal(await res.text(), body);
  });
}

test("a plain error passes to the Express default handler", async () => {
  const res = await fetch(base + "/plain");
  assert.equal(res.status, 500);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
});

test("a malformed JSON body keeps the body parser answer", async () => {
  const res = await fetch(base + "/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not json",
  });
  assert.equal(res.status, 400);
  assert.match(res.headers.get("content-type") ?? "", /text\/html/);
});

test("an error after the headers went out goes to the next handler", () => {
  const err = new ConflictError("busy");
  let passed: unknown;
  const res = {
    headersSent: true,
    status: () => assert.fail("status must not be called"),
  };
  httpErrorHandler(
    err,
    {} as Parameters<typeof httpErrorHandler>[1],
    res as unknown as Parameters<typeof httpErrorHandler>[2],
    (e?: unknown) => {
      passed = e;
    },
  );
  assert.equal(passed, err);
});
