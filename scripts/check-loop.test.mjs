import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
import { changedFiles, lintable } from "./check-changed.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = [];
const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * Make a scratch directory that the `after` hook removes.
 */
function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), "check-loop-test-"));
  scratch.push(dir);
  return dir;
}

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
 * Write a file inside a directory.
 */
function put(dir, name, content = "x\n") {
  writeFileSync(join(dir, name), content);
}

/**
 * Make a repo on main with one commit.
 */
function initRepo(files) {
  const dir = scratchDir();
  git(dir, "init", "-q", "-b", "main");
  for (const name of files) put(dir, name);
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

/**
 * Run ESLint `--print-config` and return the parsed config.
 */
function printConfig(typed) {
  const env = { ...process.env };
  delete env.NODE_ENV;
  delete env.DISPATCH_LINT_TYPED;
  if (typed) env.DISPATCH_LINT_TYPED = "1";
  const result = spawnSync(
    join(root, "node_modules/.bin/eslint"),
    ["--print-config", "src/server/bootstrap/index.ts"],
    { cwd: root, env, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("package scripts route checks through the slot gate", () => {
  const { scripts } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  const gate = "node scripts/with-check-slot.mjs";
  for (const name of [
    "lint",
    "lint:typed",
    "lint:fix",
    "typecheck",
    "test",
    "test:timing",
    "deadcode",
    "check",
    "check:static",
    "check:changed",
  ]) {
    assert.ok(scripts[name]?.includes(gate), `${name} is not gated`);
  }
  assert.equal(scripts.typecheck, `${gate} npm run typecheck:tsgo`);
  const tsgo = scripts["typecheck:tsgo"];
  assert.equal(tsgo.split("tsgo --noEmit").length - 1, 2);
  assert.ok(tsgo.includes("-p src/web/tsconfig.json"));
  assert.doesNotMatch(tsgo, /\btsc\b/);
  assert.ok(scripts["build:server"].startsWith("tsc "));
  for (const [name, value] of Object.entries(scripts)) {
    assert.ok(!value.includes("check-lock"), `${name} uses check-lock`);
  }
  assert.ok(scripts["lint:typed"].includes("DISPATCH_LINT_TYPED=1"));
  assert.ok(!scripts.lint.includes("DISPATCH_LINT_TYPED"));
  assert.equal(scripts.test, `${gate} node scripts/run-tests.mjs unit`);
  assert.equal(
    scripts["test:timing"],
    `${gate} node scripts/run-tests.mjs timing`,
  );
  assert.ok(scripts["check:unlocked"].endsWith("&& npm run test:timing"));
  assert.ok(
    readFileSync(join(root, "scripts/run-tests.mjs"), "utf8").includes(
      "scripts/**/*.test.mjs",
    ),
  );
  assert.equal(scripts.deadcode, `${gate} npm run deadcode:knip`);
  assert.ok(scripts["deadcode:knip"].includes("knip --production"));
  assert.equal(scripts["typecheck:tsc"].split("tsc --noEmit").length - 1, 2);
  assert.ok(scripts["check:changed"].includes("scripts/check-changed.mjs"));
});

test("CI runs the typed lint", () => {
  const ci = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /^\s*run: npm run lint:typed\s*$/m);
  assert.match(ci, /^\s*run: npm run typecheck:tsc\s*$/m);
});

test("ESLint is untyped by default and typed with DISPATCH_LINT_TYPED", () => {
  const untyped = printConfig(false);
  assert.equal(
    untyped.languageOptions.parserOptions?.projectService,
    undefined,
  );
  assert.equal(
    untyped.rules["@typescript-eslint/no-floating-promises"],
    undefined,
  );
  assert.ok(untyped.rules["local/comments-jsdoc-only"]);
  assert.equal(untyped.linterOptions.reportUnusedDisableDirectives, 0);
  const typed = printConfig(true);
  assert.ok(typed.languageOptions.parserOptions?.projectService);
  assert.ok(typed.rules["@typescript-eslint/no-floating-promises"]);
  assert.ok(typed.rules["local/comments-jsdoc-only"]);
  assert.equal(typed.linterOptions.reportUnusedDisableDirectives, 1);
});

test("changed files cover branch, staged, unstaged and untracked work", () => {
  const dir = initRepo(["kept.ts", "gone.ts", "staged-gone.ts", "notes.md"]);
  git(dir, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(dir, "checkout", "-q", "-b", "feature");
  put(dir, "branch.ts");
  git(dir, "add", "branch.ts");
  git(dir, "commit", "-q", "-m", "branch");
  git(dir, "rm", "-q", "gone.ts");
  git(dir, "commit", "-q", "-m", "drop gone");
  put(dir, "notes.md", "changed\n");
  put(dir, "config.json", "{}\n");
  git(dir, "add", "notes.md", "config.json");
  git(dir, "rm", "-q", "staged-gone.ts");
  put(dir, "kept.ts", "edited\n");
  put(dir, "view.tsx");
  put(dir, "ünï.ts");
  put(dir, "ignored.log");
  put(dir, ".gitignore", "*.log\n");
  const files = changedFiles(dir);
  assert.deepEqual(files, [
    ".gitignore",
    "branch.ts",
    "config.json",
    "kept.ts",
    "notes.md",
    "view.tsx",
    "ünï.ts",
  ]);
  assert.deepEqual(lintable(files), [
    "branch.ts",
    "kept.ts",
    "view.tsx",
    "ünï.ts",
  ]);
  mkdirSync(join(dir, "sub"));
  assert.deepEqual(changedFiles(join(dir, "sub")), files);
});

test("changed files throw when the base ref is missing", () => {
  const dir = initRepo(["a.ts"]);
  assert.throws(() => changedFiles(dir), /origin\/main/);
});

test("check:changed exits non-zero when the base ref is missing", () => {
  const dir = initRepo(["a.ts"]);
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts/check-changed.mjs")],
    { cwd: dir, env: gitEnv, encoding: "utf8" },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /origin\/main/);
});
