import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrerequisiteStatus } from "../../../../shared/types.js";
import {
  clearInstall,
  failInstall,
  nodeDetail,
  prerequisiteRowLabel,
  replaceStatus,
  startInstall,
  storageDetail,
} from "./prerequisite-install.js";

const tmux: PrerequisiteStatus = {
  name: "tmux",
  present: false,
  hint: null,
  installable: true,
  command: "brew install tmux",
};

test("an install runs, fails with a command, then clears", () => {
  const running = startInstall({}, "tmux");
  assert.deepEqual(running, { tmux: { phase: "installing" } });
  const failed = failInstall(running, "tmux", "brew install tmux");
  assert.deepEqual(failed, {
    tmux: { phase: "failed", command: "brew install tmux" },
  });
  assert.deepEqual(clearInstall(failed, "tmux"), {});
});

test("clearing one row keeps the others", () => {
  const state = startInstall(startInstall({}, "tmux"), "ttyd");
  assert.deepEqual(clearInstall(state, "tmux"), {
    ttyd: { phase: "installing" },
  });
});

test("replaceStatus swaps only the named row", () => {
  const git: PrerequisiteStatus = { ...tmux, name: "git" };
  const done = { ...tmux, present: true };
  assert.deepEqual(replaceStatus([tmux, git], done), [done, git]);
});

test("a present row reads as installed", () => {
  assert.equal(
    prerequisiteRowLabel({ ...tmux, present: true }),
    "tmux installed",
  );
});

test("a missing installable row names its install command", () => {
  assert.equal(
    prerequisiteRowLabel(tmux),
    "tmux missing. Install with brew install tmux",
  );
  assert.equal(
    prerequisiteRowLabel({ ...tmux, command: null }),
    "tmux missing. Install with your package manager",
  );
});

test("a missing manual row names its hint or the docs", () => {
  const claude = {
    ...tmux,
    name: "claude",
    installable: false,
    command: null,
  };
  assert.equal(
    prerequisiteRowLabel({ ...claude, hint: "npm i -g claude" }),
    "claude missing. See npm i -g claude",
  );
  assert.equal(prerequisiteRowLabel(claude), "claude missing. See the docs");
});

test("the node and storage details follow the legacy wording", () => {
  assert.equal(
    nodeDetail({ ok: true, version: "24.1.0", floor: "20" }),
    "v24.1.0",
  );
  assert.equal(
    nodeDetail({ ok: false, version: "18.0.0", floor: "20" }),
    "v18.0.0, below supported floor (20)",
  );
  assert.equal(storageDetail({ ok: true, path: "/a/b.db" }), "OK: /a/b.db");
  assert.equal(
    storageDetail({ ok: false, path: "/a/b.db" }),
    "check failed: /a/b.db",
  );
});
