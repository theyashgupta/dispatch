import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./exec.js";
import { lastCommitAt } from "./git.js";

void test("a repo reports its HEAD committer time in ms", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-lastcommit-"));
  try {
    await run("git", ["init", "-q", "-b", "main"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
    await run("git", ["add", "."], { cwd: repo });
    await run(
      "git",
      [
        "-c",
        "user.email=t@example.com",
        "-c",
        "user.name=t",
        "commit",
        "-qm",
        "a",
      ],
      {
        cwd: repo,
        env: {
          GIT_COMMITTER_DATE: "2026-09-01T12:00:00Z",
          GIT_AUTHOR_DATE: "2026-09-01T12:00:00Z",
        },
      },
    );
    assert.equal(await lastCommitAt(repo), Date.parse("2026-09-01T12:00:00Z"));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

void test("a directory outside any repo returns null", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-norepo-"));
  try {
    assert.equal(await lastCommitAt(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

void test("a missing directory returns null", async () => {
  assert.equal(
    await lastCommitAt(path.join(os.tmpdir(), "dispatch-gone-7a1b", "wt")),
    null,
  );
});
