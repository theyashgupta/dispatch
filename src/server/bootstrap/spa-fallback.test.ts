import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const { spaFallback } = await import("./index.js");
after(() => env.cleanup());

function run(method: string, originalUrl: string) {
  const [pathname] = originalUrl.split("?");
  const calls: string[] = [];
  const req = { method, path: pathname, originalUrl };
  const res = {
    redirect: (status: number, to: string) => calls.push(`${status} ${to}`),
    set: () => res,
    sendFile: (file: string) => calls.push(`file ${file}`),
  };
  let nexted = false;
  spaFallback(req as never, res as never, () => {
    nexted = true;
  });
  return { calls, nexted };
}

test("a GET under /boards/ redirects to the hash route and keeps the query", () => {
  assert.deepEqual(run("GET", "/boards/PAYMEN").calls, [
    "302 /#/boards/PAYMEN",
  ]);
  assert.deepEqual(run("GET", "/boards/PAYMEN?x=1").calls, [
    "302 /#/boards/PAYMEN?x=1",
  ]);
  assert.deepEqual(run("GET", "/boards").calls, ["302 /#/boards"]);
  assert.deepEqual(run("GET", "/boards?x=1").calls, ["302 /#/boards?x=1"]);
});

test("other GET paths serve index.html, and /api and non-GET requests pass on", () => {
  assert.deepEqual(run("GET", "/settings").calls, ["file index.html"]);
  assert.deepEqual(run("GET", "/boardsx").calls, ["file index.html"]);
  assert.equal(run("GET", "/api/boards/ACME").nexted, true);
  assert.equal(run("POST", "/boards/ACME").nexted, true);
});
