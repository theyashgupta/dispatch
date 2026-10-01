import { test } from "node:test";
import assert from "node:assert/strict";
import { routeFromMatch } from "./route.js";

test("a page leaf without an id yields the page alone", () => {
  assert.deepEqual(
    routeFromMatch({ routeId: "/board/{-$id}", params: {} }, "/board"),
    { page: "board" },
  );
});

test("a page leaf with an id yields the page and the id", () => {
  assert.deepEqual(
    routeFromMatch(
      { routeId: "/inbox/{-$id}", params: { id: "abc" } },
      "/inbox/abc",
    ),
    { page: "inbox", id: "abc" },
  );
});

test("an encoded-id leaf keeps the decoded param as given", () => {
  assert.deepEqual(
    routeFromMatch(
      { routeId: "/vault/{-$id}", params: { id: "a/b" } },
      "/vault/a%2Fb",
    ),
    { page: "vault", id: "a/b" },
  );
});

test("the root leaf falls back to the pathname", () => {
  assert.deepEqual(
    routeFromMatch({ routeId: "__root__", params: {} }, "/nope"),
    { page: "board" },
  );
  assert.deepEqual(
    routeFromMatch({ routeId: "__root__", params: {} }, "/vault/a/b"),
    { page: "vault", id: "a/b" },
  );
});

test("a missing leaf falls back to the pathname", () => {
  assert.deepEqual(routeFromMatch(undefined, "/vault/a/b"), {
    page: "vault",
    id: "a/b",
  });
});

test("a notFound leaf falls back to the pathname", () => {
  assert.deepEqual(
    routeFromMatch(
      { routeId: "/inbox/{-$id}", params: { id: "zzz" }, status: "notFound" },
      "/vault/a/b",
    ),
    { page: "vault", id: "a/b" },
  );
});

test("an unknown page segment in the routeId resolves to the board", () => {
  assert.deepEqual(
    routeFromMatch({ routeId: "/nope/{-$id}", params: {} }, "/nope"),
    { page: "board" },
  );
});
