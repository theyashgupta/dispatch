import fs from "node:fs";
import path from "node:path";

export interface FakeGhScenario {
  checks?: "pass" | "fail" | "pending" | "none";
  failViews?: number;
  pendingPolls?: number;
  author?: { name: string; email: string };
  coAuthor?: boolean;
  signatureBlock?: boolean;
  userMergesAfterPolls?: number;
  prState?: "OPEN" | "CLOSED";
  mergeError?: string;
  adminError?: string;
}

const FAKE_GH_SCRIPT = String.raw`import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(argv) + "\n");
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
};
const scenario = readJson(process.env.FAKE_GH_SCENARIO, {});
const stateFile = process.env.FAKE_GH_STATE;
const state = readJson(stateFile, { next: 1, prs: {} });
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state));
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8" });
const fail = (text) => {
  process.stderr.write(text + "\n");
  process.exit(1);
};

const remoteHead = (head) => {
  const line = git(["ls-remote", "origin", "refs/heads/" + head], process.cwd()).trim();
  return line === "" ? null : line.split("\t")[0];
};

function squashMerge(pr, subject) {
  const remote = git(["remote", "get-url", "origin"], process.cwd()).trim();
  if (!fs.existsSync(remote)) fail("fake gh: origin is not a local path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-gh-merge-"));
  try {
    git(["clone", "-q", remote, dir], process.cwd());
    git(["merge", "-q", "--squash", "origin/" + pr.head], dir);
    const author = scenario.author ?? { name: "Ship Bot", email: "ship@example.com" };
    const trailer = scenario.coAuthor ? "\n\nCo-Authored-By: Helper <helper@example.com>" : "";
    git(
      ["-c", "user.name=" + author.name, "-c", "user.email=" + author.email,
        "commit", "-q", "-m", subject + trailer],
      dir,
    );
    git(["push", "-q", "origin", "HEAD:main"], dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  pr.state = "MERGED";
}

const [group, verb, number] = argv;
if (group !== "pr") fail("fake gh: unsupported " + argv.join(" "));
if (verb === "list") {
  const head = flag("--head");
  const base = flag("--base");
  const open = head === undefined
    ? []
    : Object.entries(state.prs)
        .filter(([, p]) => p.head === head && p.state === "OPEN")
        .filter(([, p]) => base === undefined || (p.base ?? "main") === base)
        .map(([n, p]) => ({
          number: Number(n),
          baseRefName: p.base ?? "main",
          isCrossRepository: p.cross ?? false,
          headRefOid: p.headRefOid ?? remoteHead(head),
        }));
  process.stdout.write(JSON.stringify(open) + "\n");
  process.exit(0);
}
if (verb === "view" && (state.failedViews ?? 0) < (scenario.failViews ?? 0)) {
  state.failedViews = (state.failedViews ?? 0) + 1;
  save();
  fail("fake gh: error connecting to api.github.com");
}
if (verb === "create") {
  const n = state.next++;
  state.prs[n] = { head: flag("--head"), base: flag("--base"), title: flag("--title"), state: "OPEN", polls: 0, mergePolls: 0 };
  save();
  process.stdout.write("https://github.com/acme/app/pull/" + n + "\n");
  process.exit(0);
}
const pr = state.prs[number];
if (!pr) fail("fake gh: no PR " + number);
if (verb === "view" && flag("--json") === "state,statusCheckRollup") {
  pr.polls += 1;
  const conclusion =
    scenario.checks === "fail"
      ? "FAILURE"
      : scenario.checks === "pending" && pr.polls <= (scenario.pendingPolls ?? 1)
        ? null
        : "SUCCESS";
  save();
  const status = conclusion === null ? "IN_PROGRESS" : "COMPLETED";
  const rollup = scenario.checks === "none" ? [] : [{ name: "ci", status, conclusion }];
  process.stdout.write(JSON.stringify({ state: pr.state, statusCheckRollup: rollup }) + "\n");
  process.exit(0);
}
if (verb === "view" && flag("--json") === "state") {
  if (pr.state === "OPEN" && scenario.prState) pr.state = scenario.prState;
  if (pr.state === "OPEN") {
    pr.mergePolls += 1;
    const k = scenario.userMergesAfterPolls;
    if (k !== undefined && pr.mergePolls >= k) squashMerge(pr, pr.title + " (#" + number + ")");
  }
  save();
  process.stdout.write(JSON.stringify({ state: pr.state }) + "\n");
  process.exit(0);
}
if (verb === "merge") {
  const match = flag("--match-head-commit");
  if (match !== undefined && match !== remoteHead(pr.head)) {
    fail("GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)");
  }
  if (scenario.signatureBlock && !argv.includes("--admin")) {
    fail("GraphQL: Commits must have verified signatures. (mergePullRequest)");
  }
  if (scenario.adminError && argv.includes("--admin")) fail(scenario.adminError);
  if (scenario.mergeError) fail(scenario.mergeError);
  squashMerge(pr, flag("--subject"));
  save();
  process.exit(0);
}
fail("fake gh: unsupported " + argv.join(" "));
`;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Write a fake `gh` into `binDir` that logs each argv and acts on a scenario file.
 *
 * @remarks Each argv is one JSON line in `<dir>/gh-calls.jsonl`; PR numbers and poll counts live
 * in `<dir>/gh-state.json`. A merge squashes the PR head into the local bare `origin` of the
 * calling worktree, so nothing reaches a network remote. A stored PR may set `base`, `cross` and
 * `headRefOid`; the list answers the head commit of `origin` when it sets none.
 */
export function writeFakeGh(
  binDir: string,
  dir: string,
): { log: string; scenario: string } {
  const script = path.join(binDir, "fake-gh.mjs");
  const log = path.join(dir, "gh-calls.jsonl");
  const scenario = path.join(dir, "gh-scenario.json");
  const state = path.join(dir, "gh-state.json");
  fs.writeFileSync(script, FAKE_GH_SCRIPT);
  fs.writeFileSync(
    path.join(binDir, "gh"),
    [
      "#!/bin/sh",
      `FAKE_GH_LOG=${shellQuote(log)} FAKE_GH_SCENARIO=${shellQuote(scenario)} FAKE_GH_STATE=${shellQuote(state)} exec ${shellQuote(process.execPath)} ${shellQuote(script)} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { log, scenario };
}

export function setGhScenario(file: string, scenario: FakeGhScenario): void {
  fs.writeFileSync(file, JSON.stringify(scenario));
}
