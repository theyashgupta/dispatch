import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(root, ".github/workflows/changelog-sync.yml");
const skillPath = join(root, ".claude/skills/release-notes/SKILL.md");
const attachPath = join(root, ".claude/skills/release-notes/gh-attach.js");
const contributingPath = join(root, "CONTRIBUTING.md");
const URL_PATH = "repos/theyashgupta/dispatch-site/dispatches";
const EM_DASH = String.fromCharCode(0x2014);
const PROSE_GUARD = new RegExp(`${EM_DASH}|(^|[^-\\w])-{2}($|[^-\\w])`);
const scratch = [];

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * Creates a scratch directory that the `after` hook removes.
 */
function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), "release-skill-"));
  scratch.push(dir);
  return dir;
}

/**
 * Returns the dedented lines of the first `run: |` block in the workflow.
 */
function runBlock() {
  const lines = readFileSync(workflowPath, "utf8").split("\n");
  const start = lines.findIndex((l) => /^\s*run: \|\s*$/.test(l));
  assert.notEqual(start, -1, "no run: | block in changelog-sync.yml");
  const indent = lines[start + 1].match(/^ */)[0].length;
  const block = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() !== "" && line.match(/^ */)[0].length < indent) break;
    block.push(line.slice(indent));
  }
  return block.join("\n");
}

/**
 * Runs the workflow step script with a fake curl first on PATH.
 */
function runStep({ token, tag, curlExit = 0 }) {
  const dir = scratchDir();
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const curl = join(bin, "curl");
  writeFileSync(
    curl,
    `#!/bin/sh
touch "${dir}/ran"
for a in "$@"; do printf '%s\\n' "$a"; done > "${dir}/args"
cat > "${dir}/stdin"
exit ${curlExit}
`,
  );
  chmodSync(curl, 0o755);
  const res = spawnSync("bash", ["-c", runBlock()], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SITE_DEPLOY_TOKEN: token,
      TAG: tag,
    },
  });
  const read = (name) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), "utf8") : "";
  return {
    res,
    ran: existsSync(join(dir, "ran")),
    args: read("args").split("\n"),
    stdin: read("stdin"),
  };
}

const hasJq = spawnSync("jq", ["--version"]).status === 0;

/**
 * Returns the text of the CONTRIBUTING.md changelog subsection of `## Releasing`.
 */
function changelogSubsection() {
  const text = readFileSync(contributingPath, "utf8");
  const section = text.indexOf("## Releasing");
  assert.notEqual(section, -1, "no ## Releasing section");
  const start = text.indexOf("### Release notes and the changelog", section);
  assert.notEqual(start, -1, "no changelog subsection");
  const next = text.indexOf("\n## ", start);
  return text.slice(start, next === -1 ? undefined : next);
}

test("workflow triggers on release published and targets dispatch-site", () => {
  const text = readFileSync(workflowPath, "utf8");
  assert.match(text, /release:\s*\n\s*types: \[published\]/);
  assert.ok(text.includes("secrets.SITE_DEPLOY_TOKEN"));
  assert.ok(text.includes("release-published"));
  assert.ok(text.includes(URL_PATH));
});

test("empty token prints one line, exits 0, never calls curl", () => {
  const { res, ran } = runStep({ token: "", tag: "v9.9.9" });
  assert.equal(res.status, 0);
  const lines = res.stdout.split("\n").filter((l) => l.trim() !== "");
  assert.equal(lines.length, 1);
  assert.equal(ran, false);
});

test("token set sends the dispatch with the tag payload", (t) => {
  if (!hasJq) return t.skip("jq is not on PATH");
  const ok = runStep({ token: "test-token", tag: "v9.9.9" });
  assert.equal(ok.res.status, 0, ok.res.stderr);
  assert.ok(ok.args.includes("Authorization: Bearer test-token"));
  assert.ok(ok.args.includes(`https://api.github.com/${URL_PATH}`));
  assert.ok(ok.args.includes("--fail-with-body"));
  assert.deepEqual(JSON.parse(ok.stdin), {
    event_type: "release-published",
    client_payload: { tag: "v9.9.9" },
  });

  const quoted = runStep({ token: "test-token", tag: 'v1"x' });
  assert.equal(quoted.res.status, 0, quoted.res.stderr);
  assert.equal(JSON.parse(quoted.stdin).client_payload.tag, 'v1"x');
});

test("a failed dispatch fails the step", (t) => {
  if (!hasJq) return t.skip("jq is not on PATH");
  const { res } = runStep({ token: "test-token", tag: "v9.9.9", curlExit: 22 });
  assert.notEqual(res.status, 0);
});

test("SKILL.md carries the changelog entry contract", () => {
  const text = readFileSync(skillPath, "utf8");
  assert.match(text, /^---\n[\s\S]*?\nname: release-notes\n[\s\S]*?\n---/);
  for (const needle of [
    "source of truth",
    "## Changelog entry",
    "[//]: # (Release title: ",
    "This line is hidden when the release renders.",
    "one sentence",
    "vX.Y.Z - <short name>",
    "changelog-sync.yml",
    "SITE_DEPLOY_TOKEN",
  ]) {
    assert.ok(text.includes(needle), `SKILL.md is missing: ${needle}`);
  }
});

test("gh-attach.js loads as ESM and validates its arguments", () => {
  const home = scratchDir();
  const run = (...args) =>
    spawnSync("node", [attachPath, ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });
  const none = run();
  assert.equal(none.status, 1);
  assert.ok(none.stderr.includes("usage:"), none.stderr);
  const bad = run("upload", "https://example.com/x", "/nope");
  assert.equal(bad.status, 1);
  assert.ok(bad.stderr.includes("not a release edit url"), bad.stderr);
});

test("CONTRIBUTING.md Release section points to the skill", () => {
  const section = changelogSubsection();
  assert.ok(section.includes(".claude/skills/release-notes/SKILL.md"));
  assert.ok(section.includes("never by hand"));
});

test("new prose has no em dash and no double hyphen", () => {
  const sources = {
    ".claude/skills/release-notes/SKILL.md": readFileSync(skillPath, "utf8"),
    ".claude/skills/release-notes/gh-attach.js": readFileSync(
      attachPath,
      "utf8",
    ),
    ".github/workflows/changelog-sync.yml": readFileSync(workflowPath, "utf8"),
    "CONTRIBUTING.md (changelog subsection)": changelogSubsection(),
  };
  const hits = [];
  for (const [name, text] of Object.entries(sources)) {
    text.split("\n").forEach((line, i) => {
      if (PROSE_GUARD.test(line)) hits.push(`${name}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
