import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildStartCardRequest,
  buildStartGroupRequest,
  canStart,
} from "./start-request.js";

const ready = {
  pending: false,
  configError: false,
  folder: "/w",
  repoCount: 1,
  noRepositoryBoard: false,
};

test("start is enabled with a workspace and one repo", () => {
  assert.equal(canStart(ready), true);
});

test("start is disabled while a request is pending", () => {
  assert.equal(canStart({ ...ready, pending: true }), false);
});

test("start is disabled after a missing-repo refusal", () => {
  assert.equal(canStart({ ...ready, configError: true }), false);
});

test("start is disabled without a workspace or without a ticked repo", () => {
  assert.equal(canStart({ ...ready, folder: null }), false);
  assert.equal(canStart({ ...ready, repoCount: 0 }), false);
});

test("zero repos is allowed only on a board with no repository", () => {
  const none = { ...ready, repoCount: 0 };
  assert.equal(canStart({ ...none, noRepositoryBoard: true }), true);
  assert.equal(canStart({ ...none, noRepositoryBoard: false }), false);
});

test("a board with no repository still needs its folder and an idle form", () => {
  const none = { ...ready, repoCount: 0, noRepositoryBoard: true };
  assert.equal(canStart({ ...none, folder: null }), false);
  assert.equal(canStart({ ...none, pending: true }), false);
  assert.equal(canStart({ ...none, configError: true }), false);
});

test("a group start is disabled for a blank title", () => {
  assert.equal(canStart({ ...ready, titled: false }), false);
  assert.equal(canStart({ ...ready, titled: true }), true);
});

const card = {
  cardId: "c1",
  extraDirection: "go",
  folder: "/w",
  repos: [{ path: "/w/a", base: "main" }],
  playbook: "GSD",
  newSession: false,
  inherit: false,
  activeSessionId: "s1",
};

test("a first start sends the folder, repos, playbook and direction", () => {
  assert.deepEqual(buildStartCardRequest(card), {
    id: "c1",
    extraDirection: "go",
    folder: "/w",
    repos: [{ path: "/w/a", base: "main" }],
    playbook: "GSD",
    newSession: false,
    inheritFrom: undefined,
  });
});

test("a start on a board with no repository sends the board folder and no repos", () => {
  const request = buildStartCardRequest({ ...card, repos: [] });
  assert.equal(request.folder, "/w");
  assert.deepEqual(request.repos, []);
});

test("a missing folder and playbook are left out of the request", () => {
  const request = buildStartCardRequest({
    ...card,
    folder: null,
    playbook: null,
  });
  assert.equal(request.folder, undefined);
  assert.equal(request.playbook, undefined);
});

test("a new session builds on the active session only when asked", () => {
  assert.equal(
    buildStartCardRequest({ ...card, newSession: true, inherit: true })
      .inheritFrom,
    "s1",
  );
  assert.equal(
    buildStartCardRequest({ ...card, newSession: true, inherit: false })
      .inheritFrom,
    undefined,
  );
});

test("a ticked inherit box is ignored without a new session", () => {
  assert.equal(
    buildStartCardRequest({ ...card, newSession: false, inherit: true })
      .inheritFrom,
    undefined,
  );
});

test("a group request trims the title and sends every member id", () => {
  assert.deepEqual(
    buildStartGroupRequest({
      title: "  Fix [2: A-1, A-2]  ",
      memberIds: ["a", "b"],
      folder: "/w",
      repos: [{ path: "/w/a", base: "main" }],
      playbook: null,
      extraDirection: "",
    }),
    {
      title: "Fix [2: A-1, A-2]",
      memberIds: ["a", "b"],
      folder: "/w",
      repos: [{ path: "/w/a", base: "main" }],
      playbook: undefined,
      extraDirection: "",
    },
  );
});

test("a group request without a folder sends the empty string", () => {
  assert.equal(
    buildStartGroupRequest({
      title: "t",
      memberIds: [],
      folder: null,
      repos: [],
      playbook: "GSD",
      extraDirection: "",
    }).folder,
    "",
  );
});
