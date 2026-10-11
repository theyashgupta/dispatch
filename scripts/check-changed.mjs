import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const bin = (tool) => join(root, "node_modules", ".bin", tool);

/**
 * List the repo-relative files that differ from the base ref, sorted and de-duplicated.
 *
 * @remarks
 * The union covers commits since the merge base, staged edits, unstaged edits and untracked files. Paths missing on disk are dropped so a file deleted at any stage never reaches prettier or ESLint. Git runs at the repository root, because `git diff` prints root-relative paths from any subdirectory.
 */
export function changedFiles(dir, base = "origin/main") {
  const cwd = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dir,
    encoding: "utf8",
  }).trim();
  const git = (...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${base}^{commit}`],
      {
        cwd,
        stdio: "ignore",
      },
    );
  } catch {
    throw new Error(
      `check:changed: base ref ${base} not found, run git fetch origin main`,
    );
  }
  const paths = new Set([
    ...git("diff", "-z", "--name-only", "--diff-filter=d", `${base}...HEAD`),
    ...git("diff", "-z", "--name-only", "--diff-filter=d", "--cached"),
    ...git("diff", "-z", "--name-only", "--diff-filter=d"),
    ...git("ls-files", "-z", "--others", "--exclude-standard"),
  ]);
  return [...paths].filter((p) => existsSync(join(cwd, p))).sort();
}

/**
 * Keep the files that ESLint can parse.
 */
export function lintable(files) {
  return files.filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));
}

/**
 * Run prettier, ESLint and the typecheck over the changed files and return the exit code.
 *
 * @remarks
 * All three steps run even when an earlier one fails, so one run reports every problem.
 */
function main() {
  let files;
  try {
    files = changedFiles(process.cwd());
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  console.error(`check:changed: ${files.length} changed files`);
  const statuses = [];
  const step = (command, args) => {
    const result = spawnSync(command, args, { stdio: "inherit" });
    if (result.error) {
      console.error(`check:changed: ${command}: ${result.error.message}`);
    }
    statuses.push(result.status);
  };
  if (files.length > 0) {
    step(bin("prettier"), ["--check", "--ignore-unknown", "--", ...files]);
  }
  const lint = lintable(files);
  if (lint.length > 0) {
    step(bin("eslint"), [
      "--cache",
      "--cache-location",
      "node_modules/.cache/eslint/",
      "--no-warn-ignored",
      "--",
      ...lint,
    ]);
  }
  step("npm", ["run", "typecheck"]);
  return statuses.some((status) => status !== 0) ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
