import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const express = (await import("express")).default;
const { profileRouter } = await import("./profile.route.js");
const { httpErrorHandler } = await import("./error-handler.js");

const app = express();
app.use("/api", express.json(), profileRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/config/profile`;

after(() => {
  server.close();
  env.cleanup();
});

async function expectBadProfile(
  body: unknown,
  error: string,
  status = 400,
): Promise<void> {
  const res = await fetch(url, {
    method: "PUT",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(res.status, status);
  assert.equal(await res.text(), JSON.stringify({ error }));
}

test("PUT with no body answers 400 profile must be an object", async () => {
  await expectBadProfile(undefined, "profile must be an object");
});

test("PUT with an array body answers 400 profile must be an object", async () => {
  await expectBadProfile([], "profile must be an object");
});

test("PUT with a non-text field answers 400 naming the field", async () => {
  await expectBadProfile({ name: 5 }, "name must be text");
  await expectBadProfile({ email: 5 }, "email must be text");
  await expectBadProfile({ role: true }, "role must be text");
  await expectBadProfile({ brief: {} }, "brief must be text");
});

test("PUT with an over-long field answers 400 with its limit", async () => {
  await expectBadProfile(
    { name: "a".repeat(201) },
    "name must be at most 200 characters",
  );
  await expectBadProfile(
    { email: "a".repeat(201) },
    "email must be at most 200 characters",
  );
  await expectBadProfile(
    { role: "a".repeat(201) },
    "role must be at most 200 characters",
  );
  await expectBadProfile(
    { brief: "a".repeat(4001) },
    "brief must be at most 4000 characters",
  );
});

test("PUT with handles that are not a list answers 400 handles must be a list", async () => {
  await expectBadProfile({ handles: "ada" }, "handles must be a list");
});

test("PUT with a non-text handle answers 400 each handle must be text", async () => {
  await expectBadProfile({ handles: [1] }, "each handle must be text");
});

test("PUT with an over-long handle answers 400 with the handle limit", async () => {
  await expectBadProfile(
    { handles: ["a".repeat(101)] },
    "each handle must be at most 100 characters",
  );
});

test("PUT with more than 20 distinct handles answers 400 at most 20 handles", async () => {
  const handles = Array.from({ length: 21 }, (_, i) => `h${i}`);
  await expectBadProfile({ handles }, "at most 20 handles");
});

test("the first failing field decides the code", async () => {
  await expectBadProfile(
    { name: 5, email: 5, handles: "x" },
    "name must be text",
  );
  await expectBadProfile({ brief: 5, handles: "x" }, "brief must be text");
});
