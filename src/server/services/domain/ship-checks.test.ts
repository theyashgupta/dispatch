import test from "node:test";
import assert from "node:assert/strict";
import {
  checksState,
  identityCheck,
  isSignatureBlock,
  nextBranchState,
  proseViolations,
  repoOfRemote,
} from "./ship-checks.js";

const DASH = String.fromCharCode(0x2014);
const DH = "-".repeat(2);

/** A one-file unified diff whose hunk carries `lines` as given (prefixes included). */
function diffOf(file: string, lines: string[]): string {
  return [
    `diff ${DH}git a/${file} b/${file}`,
    `${"-".repeat(3)} a/${file}`,
    `+++ b/${file}`,
    "@@ -1,1 +1,9 @@",
    ...lines,
  ].join("\n");
}

const kinds = (diff: string) =>
  proseViolations(diff).map((v) => `${v.file}:${v.kind}`);

void test("an em dash on any added line in scope is a violation", () => {
  for (const file of [
    "docs/a.md",
    "src/x.ts",
    "scripts/s.mjs",
    ".claude/agents/a.md",
    "CLAUDE.md",
  ]) {
    assert.deepEqual(kinds(diffOf(file, [`+const a = "x ${DASH} y";`])), [
      `${file}:em-dash`,
    ]);
  }
  assert.deepEqual(kinds(diffOf("docs/a.md", ["+```", `+a ${DASH} b`])), [
    "docs/a.md:em-dash",
  ]);
});

void test("files out of scope, removed lines and context lines are not checked", () => {
  assert.deepEqual(kinds(diffOf("README.md", [`+a ${DASH} b ${DH} c`])), []);
  assert.deepEqual(kinds(diffOf("lib/x.md", [`+a ${DASH} b`])), []);
  assert.deepEqual(
    kinds(diffOf("docs/a.md", [`-a ${DASH} b`, ` a ${DH} b`])),
    [],
  );
});

void test("a double hyphen on a markdown prose line is a violation", () => {
  const found = proseViolations(diffOf("docs/a.md", [`+one ${DH} two`]));
  assert.deepEqual(found, [
    { file: "docs/a.md", line: `one ${DH} two`, kind: "double-hyphen" },
  ]);
  assert.deepEqual(kinds(diffOf("CLAUDE.md", [`+one ${DH} two`])), [
    "CLAUDE.md:double-hyphen",
  ]);
});

void test("markdown code spans, fenced blocks and table delimiter rows are exempt", () => {
  assert.deepEqual(kinds(diffOf("docs/a.md", [`+run \`git ${DH}all\``])), []);
  assert.deepEqual(
    kinds(diffOf("docs/a.md", ["+```sh", `+git log ${DH}oneline`, "+```"])),
    [],
  );
  assert.deepEqual(
    kinds(diffOf("docs/a.md", [" ```", `+git log ${DH}oneline`, " ```"])),
    [],
  );
  for (const row of [
    `| ${DH}- | ${DH}- |`,
    `|:${DH}|${DH}:|`,
    `${DH}- | ${DH}-`,
    `| :${DH}-: |`,
  ]) {
    assert.deepEqual(kinds(diffOf("docs/a.md", [`+${row}`])), [], row);
  }
  assert.deepEqual(
    kinds(diffOf("docs/a.md", ["+```", "+x", "+```", `+after ${DH} fence`])),
    ["docs/a.md:double-hyphen"],
  );
});

void test("in code files only comment lines count for a double hyphen", () => {
  for (const line of [
    ` * a ${DH} b`,
    `/** a ${DH} b */`,
    `  // a ${DH} b`,
    `# a ${DH} b`,
  ]) {
    assert.deepEqual(
      kinds(diffOf("src/x.ts", [`+${line}`])),
      ["src/x.ts:double-hyphen"],
      line,
    );
  }
  assert.deepEqual(kinds(diffOf("src/x.ts", [`+run(["${DH}all"]);`])), []);
  assert.deepEqual(kinds(diffOf("src/x.ts", [`+ * run \`${DH}all\``])), []);
});

void test("files are told apart across a multi-file diff", () => {
  const diff = [
    diffOf("src/ok.ts", [`+x(${DH}y);`]),
    diffOf("docs/b.md", [`+bad ${DH} line`]),
  ].join("\n");
  assert.deepEqual(kinds(diff), ["docs/b.md:double-hyphen"]);
});

const ME = { name: "Ship Bot", email: "ship@example.com" };

void test("identityCheck passes the right author and refuses a wrong one or a co-author", () => {
  const tip = {
    authorName: ME.name,
    authorEmail: ME.email,
    message: "feat: x (#1)\n",
  };
  assert.deepEqual(identityCheck(ME, tip), { ok: true });
  assert.deepEqual(identityCheck(ME, { ...tip, authorName: "Other" }), {
    ok: false,
    reason:
      "author Other <ship@example.com> is not Ship Bot <ship@example.com>",
  });
  assert.equal(
    identityCheck(ME, { ...tip, authorEmail: "x@example.com" }).ok,
    false,
  );
  assert.deepEqual(
    identityCheck(ME, {
      ...tip,
      message: "feat: x (#1)\n\nco-authored-by: Helper <h@example.com>\n",
    }),
    { ok: false, reason: "commit has a Co-Authored-By line" },
  );
});

void test("checksState folds a rollup", () => {
  const at = (rollup: Parameters<typeof checksState>[0]) =>
    checksState(rollup, 1);
  assert.equal(at([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }]), "passed");
  assert.equal(
    at([{ conclusion: "NEUTRAL" }, { conclusion: "SKIPPED" }]),
    "passed",
  );
  for (const bad of [
    "FAILURE",
    "CANCELLED",
    "TIMED_OUT",
    "ACTION_REQUIRED",
    "ERROR",
    "STARTUP_FAILURE",
    "STALE",
    "SOMETHING_NEW",
  ]) {
    assert.equal(
      at([{ conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: bad }]),
      "failed",
      bad,
    );
    assert.equal(at([{ conclusion: bad }]), "failed", bad);
  }
  assert.equal(at([{ status: "COMPLETED", conclusion: null }]), "failed");
  assert.equal(at([{ status: "IN_PROGRESS", conclusion: null }]), "pending");
  assert.equal(
    at([{ conclusion: "SUCCESS" }, { state: "PENDING" }]),
    "pending",
  );
  assert.equal(at([{ state: "PENDING" }, { conclusion: "FAILURE" }]), "failed");
  assert.equal(at([{ state: "ERROR" }]), "failed");
});

void test("checksState holds an empty rollup pending for 3 polls, then passes it", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((poll) => checksState([], poll)),
    ["pending", "pending", "pending", "passed", "passed"],
  );
  assert.equal(checksState([{ status: "QUEUED" }], 9), "pending");
});

void test("isSignatureBlock is true only when the signature rule is the one rule named", () => {
  const table: [string, boolean][] = [
    [
      "GraphQL: Commits must have verified signatures. (mergePullRequest)",
      true,
    ],
    ["signatures are required", false],
    ["signature mismatch", false],
    ["Pull request is not mergeable", false],
    [
      "Repository rule violations found\n- Commits must have verified signatures.\n- At least 1 approving review is required.",
      false,
    ],
    [
      "Commits must have verified signatures. Changes must be made through a pull request.",
      false,
    ],
    [
      "Required status check ci is expected. Commits must have verified signatures.",
      false,
    ],
    ["Commits must have verified signatures. Review required.", false],
    ["COMMITS MUST HAVE VERIFIED SIGNATURES; APPROVALS NEEDED", false],
    [
      "GraphQL: Repository rule violations found\n\n- Commits must have verified signatures.\n\n (mergePullRequest)",
      true,
    ],
    [
      "GraphQL: Repository rule violations found\n\n- Commits must have verified signatures.\n- Required deployments must succeed before merging: production\n\n (mergePullRequest)",
      false,
    ],
    [
      "Repository rule violations found\n- Commits must have verified signatures.\n- Code scanning results are required.",
      false,
    ],
    ["", false],
    ["Repository rule violations found\n(mergePullRequest)", false],
    ['Required status check "verify-signature" is expected', false],
    [
      'Repository rule violations found\n- Commits must have verified signatures.\n- Required status check "gpg-signature" is expected.',
      false,
    ],
    [
      "Commits must have verified signatures, and 2 approving reviews are required",
      false,
    ],
  ];
  for (const [stderr, expected] of table) {
    assert.equal(isSignatureBlock(stderr), expected, stderr);
  }
});

void test("nextBranchState follows the order for both rights", () => {
  const walk = (rights: "merge" | "open_prs") => {
    const seen = [];
    let s = nextBranchState("queued", rights);
    while (s !== "merged") {
      seen.push(s);
      s = nextBranchState(s, rights);
    }
    return seen;
  };
  assert.deepEqual(walk("merge"), [
    "merging_main",
    "checking",
    "pushing",
    "waiting_checks",
    "merging",
    "verifying",
  ]);
  assert.deepEqual(walk("open_prs"), [
    "merging_main",
    "checking",
    "pushing",
    "waiting_checks",
    "waiting_merge",
    "verifying",
  ]);
  assert.equal(nextBranchState("merged", "merge"), "merged");
  assert.equal(nextBranchState("failed", "open_prs"), "failed");
});

void test("a header path with a space keeps the md rule after git's trailing tab", () => {
  const diff = [
    `diff ${DH}git a/docs/my file.md b/docs/my file.md`,
    `${"-".repeat(3)} a/docs/my file.md\t`,
    "+++ b/docs/my file.md\t",
    "@@ -1,1 +1,2 @@",
    `+one ${DH} two`,
  ].join("\n");
  assert.deepEqual(
    proseViolations(diff).map((v) => `${v.file}:${v.kind}`),
    ["docs/my file.md:double-hyphen"],
  );
});

void test("a hunk under a header with no parsed file fails closed, and a deleted file does not", () => {
  const quoted = [
    `diff ${DH}git "a/docs/we\\"ird.md" "b/docs/we\\"ird.md"`,
    `${"-".repeat(3)} "a/docs/we\\"ird.md"`,
    '+++ "b/docs/we\\"ird.md"',
    "@@ -1,1 +1,2 @@",
    "+plain text",
  ].join("\n");
  assert.deepEqual(
    proseViolations(quoted).map((v) => v.kind),
    ["unparsed-header"],
  );
  const noHeader = [`diff ${DH}git a/x b/x`, "@@ -1 +1 @@", "+x"].join("\n");
  assert.deepEqual(
    proseViolations(noHeader).map((v) => v.kind),
    ["unparsed-header"],
  );
  const deleted = [
    `diff ${DH}git a/docs/old.md b/docs/old.md`,
    `${"-".repeat(3)} a/docs/old.md`,
    "+++ /dev/null",
    "@@ -1,1 +0,0 @@",
    `-gone ${DH} line`,
  ].join("\n");
  assert.deepEqual(proseViolations(deleted), []);
});

void test("repoOfRemote names a github.com repository and gives null for any other host or a local path", () => {
  const table: [string, string | null][] = [
    ["git@github.com:acme/app.git", "acme/app"],
    ["https://github.com/acme/app.git", "acme/app"],
    ["https://github.com/acme/app", "acme/app"],
    ["ssh://git@github.com/acme/app.git", "acme/app"],
    ["https://user@github.com/acme/app.git/", "acme/app"],
    ["git@GitHub.com:acme/app.git", "acme/app"],
    ["ssh://git@ssh.github.com:443/acme/app.git", "acme/app"],
    ["git@github-work:acme/app.git", null],
    ["ssh://git@github-work:443/acme/app.git", null],
    ["git@ghe.example.com:acme/app.git", null],
    ["ssh://git@ghe.example.com:2222/acme/app.git", null],
    ["/tmp/root/origin.git", null],
    ["../origin.git", null],
    ["../x/origin.git", null],
    ["file:///tmp/root/origin.git", null],
    ["https://github.com/acme", null],
    ["https://github.com/acme/app/extra", null],
    ["", null],
  ];
  for (const [url, expected] of table) {
    assert.equal(repoOfRemote(url), expected, url);
  }
});
