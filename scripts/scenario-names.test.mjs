import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
import {
  parseNumbered,
  parseTicketed,
  renderList,
  replaceList,
  rewriteLabels,
  rewriteReferences,
  scenarioDrift,
  targetName,
  ticketOfSubject,
} from "./scenario-names.mjs";

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "scenario-names.mjs",
);
const scratch = [];
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const EMPTY_BLOCK =
  "<!-- scenario-list:start -->\n\n<!-- scenario-list:end -->";
const ALPHA = `const note = makeNote("scenario-3");
const sb = startSandbox({ name: "s3-alpha" });
import x from "./fixtures/scenario-3/x.js";
`;

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * Run git in a directory with a fixed identity and no signing.
 */
function git(dir, ...args) {
  return execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: dir, env: gitEnv, encoding: "utf8" },
  );
}

/**
 * Write a file inside a directory, creating parent folders.
 */
function put(dir, name, content) {
  mkdirSync(dirname(join(dir, name)), { recursive: true });
  writeFileSync(join(dir, name), content);
}

/**
 * Make a scratch repo whose first commit adds the alpha scenario, a package script and a doc.
 */
function initRepo(branch = "main") {
  const dir = mkdtempSync(join(tmpdir(), "scenario-names-test-"));
  scratch.push(dir);
  git(dir, "init", "-q", "-b", branch);
  put(dir, "tests/e2e/scenario-3-alpha.e2e.ts", ALPHA);
  put(
    dir,
    "package.json",
    '{ "e2e": "node --test tests/e2e/scenario-3-alpha.e2e.ts" }\n',
  );
  put(
    dir,
    "docs/ARCHITECTURE.md",
    `Scenario 3 (tests/e2e/scenario-3-alpha.e2e.ts) proves x.\n\n${EMPTY_BLOCK}\n`,
  );
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "test: add alpha (LOCAL-7) (#1)");
  return dir;
}

/**
 * Run the script CLI inside a scratch repo.
 */
function runCli(dir, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    env: gitEnv,
    encoding: "utf8",
  });
}

test("ticketOfSubject takes the ticket after the title", () => {
  assert.equal(ticketOfSubject("fix(ship): x (LOCAL-171) (#298)"), "LOCAL-171");
});

test("ticketOfSubject takes the first of several tickets", () => {
  assert.equal(
    ticketOfSubject(
      "test(orchestration): add the G20 unit specs and scenarios 4 and 5 (LOCAL-95, LOCAL-96, LOCAL-97) (#232)",
    ),
    "LOCAL-95",
  );
});

test("ticketOfSubject ignores text after the ticket", () => {
  assert.equal(
    ticketOfSubject(
      "test(orchestrator): add the specs and scenario 7 (LOCAL-104 Part 1a) (#243)",
    ),
    "LOCAL-104",
  );
});

test("ticketOfSubject ignores UTF-8 and PR numbers", () => {
  assert.equal(ticketOfSubject("fix: handle UTF-8 input"), undefined);
  assert.equal(ticketOfSubject("chore: x (#12)"), undefined);
});

test("parseNumbered reads a letter suffix", () => {
  assert.deepEqual(parseNumbered("scenario-6b-ship-order.e2e.ts"), {
    token: "6b",
    slug: "ship-order",
  });
});

test("parseNumbered skips a ticket-based name", () => {
  assert.equal(parseNumbered("scenario-LOCAL-7-alpha.e2e.ts"), undefined);
});

test("targetName builds the ticket-based name", () => {
  assert.equal(
    targetName("scenario-20-frozen-relaunch.e2e.ts", "LOCAL-170"),
    "scenario-LOCAL-170-frozen-relaunch.e2e.ts",
  );
});

const engine = { token: "10", ticket: "LOCAL-151", slug: "engine-close" };

test("rewriteLabels rewrites the short label", () => {
  assert.equal(
    rewriteLabels('"s10-engine-close"', engine),
    '"local-151-engine-close"',
  );
});

test("rewriteLabels rewrites a bare scenario label", () => {
  assert.equal(
    rewriteLabels('makeNote("scenario-10")', engine),
    'makeNote("local-151-engine-close")',
  );
});

test("rewriteLabels keeps the suffix of a longer label", () => {
  assert.equal(
    rewriteLabels('"scenario-10-run-log.txt"', engine),
    '"local-151-engine-close-run-log.txt"',
  );
});

test("rewriteLabels leaves other scenarios and fixture paths", () => {
  assert.equal(
    rewriteLabels('"./fixtures/scenario-1/repo.js"', engine),
    '"./fixtures/scenario-1/repo.js"',
  );
  assert.equal(rewriteLabels('"scenario-1"', engine), '"scenario-1"');
  assert.equal(rewriteLabels('"s1-alpha"', engine), '"s1-alpha"');
});

test("rewriteLabels matches the whole token", () => {
  const one = { token: "1", ticket: "LOCAL-93", slug: "orchestrated" };
  assert.equal(rewriteLabels('"scenario-10"', one), '"scenario-10"');
  assert.equal(
    rewriteLabels('"s1-alpha"', one),
    '"local-93-orchestrated-alpha"',
  );
  assert.equal(
    rewriteLabels('"s1-orchestrated"', one),
    '"local-93-orchestrated"',
  );
});

test("rewriteLabels keeps a suffix that repeats part of the slug", () => {
  assert.equal(
    rewriteLabels('"scenario-12-limit-move-run-log.txt"', {
      token: "12",
      ticket: "LOCAL-152",
      slug: "limit-account-move",
    }),
    '"local-152-limit-account-move-limit-move-run-log.txt"',
  );
});

test("rewriteLabels rewrites a test title that opens with a scenario number", () => {
  assert.equal(
    rewriteLabels('"scenario 10 code types no key into any pane"', engine),
    '"scenario-LOCAL-151-engine-close code types no key into any pane"',
  );
  assert.equal(
    rewriteLabels('"scenario 10: the supervisor closes"', engine),
    '"scenario-LOCAL-151-engine-close: the supervisor closes"',
  );
  assert.equal(
    rewriteLabels('"scenario 6 part B: a quick fix"', {
      token: "6b",
      ticket: "LOCAL-109",
      slug: "ship-order",
    }),
    '"scenario-LOCAL-109-ship-order: a quick fix"',
  );
  assert.equal(
    rewriteLabels('"scenario 17: x"', engine),
    '"scenario-LOCAL-151-engine-close: x"',
  );
  assert.equal(
    rewriteLabels('"the scenario 10 run"', engine),
    '"the scenario 10 run"',
  );
});

test("parseTicketed reads the ticket and slug", () => {
  assert.deepEqual(
    parseTicketed("scenario-LOCAL-163-missing-workspace.e2e.ts"),
    { ticket: "LOCAL-163", slug: "missing-workspace" },
  );
  assert.equal(parseTicketed("scenario-14-x.e2e.ts"), undefined);
});

test("renderList sorts by prefix, ticket number and slug", () => {
  assert.equal(
    renderList([
      "scenario-LOCAL-93-parity.e2e.ts",
      "scenario-LOCAL-9-alpha.e2e.ts",
      "scenario-LOCAL-93-orchestrated.e2e.ts",
      "scenario-3-numbered.e2e.ts",
    ]),
    [
      "- tests/e2e/scenario-LOCAL-9-alpha.e2e.ts (LOCAL-9)",
      "- tests/e2e/scenario-LOCAL-93-orchestrated.e2e.ts (LOCAL-93)",
      "- tests/e2e/scenario-LOCAL-93-parity.e2e.ts (LOCAL-93)",
    ].join("\n"),
  );
});

test("replaceList fills an empty block", () => {
  assert.equal(
    replaceList(`a\n\n${EMPTY_BLOCK}\n\nb\n`, "- x"),
    "a\n\n<!-- scenario-list:start -->\n\n- x\n\n<!-- scenario-list:end -->\n\nb\n",
  );
});

test("replaceList replaces an old block", () => {
  const old =
    "a\n<!-- scenario-list:start -->\n\n- old\n- older\n\n<!-- scenario-list:end -->\nb\n";
  assert.equal(
    replaceList(old, "- new"),
    "a\n<!-- scenario-list:start -->\n\n- new\n\n<!-- scenario-list:end -->\nb\n",
  );
});

test("replaceList returns undefined without both markers", () => {
  assert.equal(replaceList("no markers\n", "- x"), undefined);
  assert.equal(replaceList("<!-- scenario-list:start -->\n", "- x"), undefined);
});

test("rewriteReferences rewrites markdown lead-in and path", () => {
  assert.equal(
    rewriteReferences(
      "Scenario 14 (tests/e2e/scenario-14-missing-workspace.e2e.ts) proves",
      ["scenario-LOCAL-163-missing-workspace.e2e.ts"],
      true,
    ),
    "The scenario in tests/e2e/scenario-LOCAL-163-missing-workspace.e2e.ts proves",
  );
});

test("rewriteReferences handles a part letter", () => {
  assert.equal(
    rewriteReferences(
      "Scenario 6 part B (tests/e2e/scenario-6b-ship-order.e2e.ts)",
      ["scenario-LOCAL-109-ship-order.e2e.ts"],
      true,
    ),
    "The scenario in tests/e2e/scenario-LOCAL-109-ship-order.e2e.ts",
  );
});

test("rewriteReferences leaves the lead-in outside markdown", () => {
  assert.equal(
    rewriteReferences(
      "Scenario 3 (tests/e2e/scenario-3-alpha.e2e.ts)",
      ["scenario-LOCAL-7-alpha.e2e.ts"],
      false,
    ),
    "Scenario 3 (tests/e2e/scenario-LOCAL-7-alpha.e2e.ts)",
  );
});

test("rewriteReferences leaves a slug with zero or two matches", () => {
  const text = "scenario-3-alpha.e2e.ts";
  assert.equal(rewriteReferences(text, [], false), text);
  assert.equal(
    rewriteReferences(
      text,
      ["scenario-LOCAL-7-alpha.e2e.ts", "scenario-LOCAL-8-alpha.e2e.ts"],
      false,
    ),
    text,
  );
});

test("rewriteReferences leaves a name that still exists", () => {
  const text = "scenario-3-alpha.e2e.ts";
  assert.equal(
    rewriteReferences(
      text,
      ["scenario-3-alpha.e2e.ts", "scenario-LOCAL-7-alpha.e2e.ts"],
      false,
    ),
    text,
  );
});

test("CLI renames the file, labels and references", () => {
  const dir = initRepo();
  const run = runCli(dir);
  assert.equal(run.status, 0, run.stderr);
  const next = join(dir, "tests/e2e/scenario-LOCAL-7-alpha.e2e.ts");
  assert.ok(existsSync(next));
  assert.ok(!existsSync(join(dir, "tests/e2e/scenario-3-alpha.e2e.ts")));
  const body = readFileSync(next, "utf8");
  assert.match(body, /makeNote\("local-7-alpha"\)/);
  assert.match(body, /name: "local-7-alpha"/);
  assert.match(body, /\.\/fixtures\/scenario-3\/x\.js/);
  assert.match(
    readFileSync(join(dir, "package.json"), "utf8"),
    /tests\/e2e\/scenario-LOCAL-7-alpha\.e2e\.ts/,
  );
  assert.equal(
    readFileSync(join(dir, "docs/ARCHITECTURE.md"), "utf8"),
    "The scenario in tests/e2e/scenario-LOCAL-7-alpha.e2e.ts proves x.\n\n<!-- scenario-list:start -->\n\n- tests/e2e/scenario-LOCAL-7-alpha.e2e.ts (LOCAL-7)\n\n<!-- scenario-list:end -->\n",
  );
  assert.match(git(dir, "status", "--porcelain"), /^R/m);
});

test("CLI second run changes nothing", () => {
  const dir = initRepo();
  assert.equal(runCli(dir).status, 0);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "rename");
  const run = runCli(dir);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.doesNotMatch(run.stdout, / -> /);
});

test("CLI fails and renames nothing when a file has no ticket", () => {
  const dir = initRepo();
  put(dir, "tests/e2e/scenario-4-beta.e2e.ts", "x\n");
  const run = runCli(dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /scenario-4-beta\.e2e\.ts/);
  assert.ok(existsSync(join(dir, "tests/e2e/scenario-3-alpha.e2e.ts")));
  assert.ok(!existsSync(join(dir, "tests/e2e/scenario-LOCAL-7-alpha.e2e.ts")));
});

test("CLI falls back to the branch ticket for an untracked file", () => {
  const dir = initRepo("LOCAL-9");
  put(dir, "tests/e2e/scenario-4-beta.e2e.ts", "x\n");
  const run = runCli(dir);
  assert.equal(run.status, 0, run.stderr);
  assert.ok(existsSync(join(dir, "tests/e2e/scenario-LOCAL-9-beta.e2e.ts")));
  assert.ok(!existsSync(join(dir, "tests/e2e/scenario-4-beta.e2e.ts")));
});

test("CLI refuses the branch ticket for a committed file with no ticket", () => {
  const dir = initRepo("LOCAL-9");
  put(dir, "tests/e2e/scenario-4-beta.e2e.ts", "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "test: add beta");
  const run = runCli(dir);
  assert.equal(run.status, 1);
  assert.match(run.stderr, /scenario-4-beta\.e2e\.ts/);
  assert.ok(existsSync(join(dir, "tests/e2e/scenario-4-beta.e2e.ts")));
});

test("CLI writes the doc list and --check passes", () => {
  const dir = initRepo();
  assert.equal(runCli(dir).status, 0);
  assert.match(
    readFileSync(join(dir, "docs/ARCHITECTURE.md"), "utf8"),
    /<!-- scenario-list:start -->\n\n- tests\/e2e\/scenario-LOCAL-7-alpha\.e2e\.ts \(LOCAL-7\)\n\n<!-- scenario-list:end -->/,
  );
  const check = runCli(dir, "--check");
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stderr, "");
});

test("--check reports numbered files, references and a stale list", () => {
  const dir = initRepo();
  put(dir, "tests/e2e/scenario-LOCAL-8-beta.e2e.ts", "x\n");
  const check = runCli(dir, "--check");
  assert.equal(check.status, 1);
  assert.match(
    check.stderr,
    /tests\/e2e\/scenario-3-alpha\.e2e\.ts: numbered scenario file/,
  );
  assert.match(
    check.stderr,
    /package\.json:1: numbered scenario reference scenario-3-alpha\.e2e\.ts/,
  );
  assert.match(check.stderr, /scenario list is stale/);
});

test("--check reports a list line that was removed", () => {
  const dir = initRepo();
  assert.equal(runCli(dir).status, 0);
  put(dir, "docs/ARCHITECTURE.md", `Text.\n\n${EMPTY_BLOCK}\n`);
  const check = runCli(dir, "--check");
  assert.equal(check.status, 1);
  assert.match(check.stderr, /scenario list is stale/);
});

test("a doc without markers fails --check and the apply run", () => {
  const dir = initRepo();
  put(dir, "docs/ARCHITECTURE.md", "No markers here.\n");
  const check = runCli(dir, "--check");
  assert.equal(check.status, 1);
  assert.match(check.stderr, /markers are missing/);
  const apply = runCli(dir);
  assert.equal(apply.status, 1);
  assert.match(apply.stderr, /markers are missing/);
  assert.ok(existsSync(join(dir, "tests/e2e/scenario-3-alpha.e2e.ts")));
});

test("--check reports a numbered label in a renamed file", () => {
  const dir = initRepo();
  assert.equal(runCli(dir).status, 0);
  const file = join(dir, "tests/e2e/scenario-LOCAL-7-alpha.e2e.ts");
  writeFileSync(
    file,
    `${readFileSync(file, "utf8")}const t = "scenario 21: x";\n`,
  );
  const check = runCli(dir, "--check");
  assert.equal(check.status, 1);
  assert.match(check.stderr, /numbered label scenario 21/);
});

test("rewriteReferences prefers the renamed map over the slug fallback", () => {
  assert.equal(
    rewriteReferences(
      "tests/e2e/scenario-9-ship-retry.e2e.ts",
      [
        "scenario-LOCAL-171-ship-retry.e2e.ts",
        "scenario-LOCAL-200-ship-retry.e2e.ts",
      ],
      false,
      new Map([
        [
          "scenario-9-ship-retry.e2e.ts",
          "scenario-LOCAL-200-ship-retry.e2e.ts",
        ],
      ]),
    ),
    "tests/e2e/scenario-LOCAL-200-ship-retry.e2e.ts",
  );
});

test("rewriteReferences rewrites the markdown lead-in only at line start", () => {
  const names = ["scenario-LOCAL-7-alpha.e2e.ts"];
  const midLine = "see Scenario 3 (tests/e2e/scenario-LOCAL-7-alpha.e2e.ts)";
  assert.equal(rewriteReferences(midLine, names, true), midLine);
  assert.equal(
    rewriteReferences(
      "Scenario 3 (tests/e2e/scenario-LOCAL-7-alpha.e2e.ts)",
      names,
      true,
    ),
    "The scenario in tests/e2e/scenario-LOCAL-7-alpha.e2e.ts",
  );
});

test("--check reports only labels the rename run can rewrite", () => {
  const dir = initRepo();
  assert.equal(runCli(dir).status, 0);
  const file = join(dir, "tests/e2e/scenario-LOCAL-7-alpha.e2e.ts");
  const base = readFileSync(file, "utf8");
  writeFileSync(file, `${base}const a = "s1: x";\n`);
  const colon = runCli(dir, "--check");
  assert.equal(colon.status, 0, colon.stderr);
  assert.doesNotMatch(colon.stderr, /numbered label/);
  writeFileSync(file, `${base}const b = "s1-x";\n`);
  const dash = runCli(dir, "--check");
  assert.equal(dash.status, 1);
  assert.match(dash.stderr, /numbered label s1$/m);
});

test("--check outside a git repo fails and does not report zero drift", () => {
  const dir = mkdtempSync(join(tmpdir(), "scenario-names-test-"));
  scratch.push(dir);
  put(dir, "tests/e2e/scenario-LOCAL-7-alpha.e2e.ts", "x\n");
  put(
    dir,
    "docs/ARCHITECTURE.md",
    `Text.\n\n${EMPTY_BLOCK.replace("\n\n", "\n\n- tests/e2e/scenario-LOCAL-7-alpha.e2e.ts (LOCAL-7)\n\n")}\n`,
  );
  const check = runCli(dir, "--check");
  assert.notEqual(check.status, 0);
  assert.doesNotMatch(check.stdout, /PASS/);
  assert.throws(() => scenarioDrift(dir));
});

test("CLI rewrites a reference in a committed text file", () => {
  const dir = initRepo();
  put(dir, "notes.txt", "run tests/e2e/scenario-3-alpha.e2e.ts first\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "docs: add notes");
  const run = runCli(dir);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(
    readFileSync(join(dir, "notes.txt"), "utf8"),
    "run tests/e2e/scenario-LOCAL-7-alpha.e2e.ts first\n",
  );
});
