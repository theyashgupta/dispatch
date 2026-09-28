import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  classifyCheckRun,
  classifyStatus,
  FILES_MAX,
  fetchPrDetail,
  mapPrDetail,
  mergeChecks,
  PATCH_MAX,
  type RawPull,
} from "./github-pr.js";

afterEach(() => mock.restoreAll());

const pull: RawPull = {
  title: "Fix race",
  body: "Body",
  html_url: "https://github.com/acme/api/pull/12",
  user: { login: "mchen" },
  state: "open",
  merged_at: null,
  draft: false,
  base: { ref: "main" },
  head: { ref: "fix/race", sha: "a".repeat(40) },
  additions: 10,
  deletions: 2,
  changed_files: 3,
};

test("a completed run passes only on success, skipped or neutral", () => {
  const cases: [string | null, "pass" | "fail"][] = [
    ["success", "pass"],
    ["skipped", "pass"],
    ["neutral", "pass"],
    ["failure", "fail"],
    ["cancelled", "fail"],
    ["timed_out", "fail"],
    ["action_required", "fail"],
    ["stale", "fail"],
    ["something_new", "fail"],
    [null, "fail"],
  ];
  for (const [conclusion, want] of cases) {
    assert.equal(
      classifyCheckRun({ name: "x", status: "completed", conclusion }),
      want,
      String(conclusion),
    );
  }
});

test("a run that is not completed is pending", () => {
  assert.equal(
    classifyCheckRun({ name: "x", status: "in_progress", conclusion: null }),
    "pending",
  );
  assert.equal(classifyCheckRun({ name: "x", status: "queued" }), "pending");
});

test("a legacy status passes only on success", () => {
  assert.equal(classifyStatus("success"), "pass");
  assert.equal(classifyStatus("pending"), "pending");
  assert.equal(classifyStatus("failure"), "fail");
  assert.equal(classifyStatus("error"), "fail");
  assert.equal(classifyStatus("weird"), "fail");
});

test("checks sort fail, pending, pass, then by name, with links kept", () => {
  const checks = mergeChecks(
    [
      { name: "b-lint", status: "completed", conclusion: "success" },
      {
        name: "z-unit",
        status: "completed",
        conclusion: "failure",
        html_url: "https://ci/z",
      },
      { name: "a-build", status: "in_progress" },
    ],
    [{ context: "a-vercel", state: "failure", target_url: "https://v/1" }],
  );
  assert.deepEqual(checks, [
    { name: "a-vercel", state: "fail", url: "https://v/1" },
    { name: "z-unit", state: "fail", url: "https://ci/z" },
    { name: "a-build", state: "pending" },
    { name: "b-lint", state: "pass" },
  ]);
});

test("patches are cut at 6000 characters with the flag set", () => {
  const detail = mapPrDetail(
    pull,
    [
      { filename: "long.ts", patch: "x".repeat(PATCH_MAX + 1) },
      { filename: "exact.ts", patch: "y".repeat(PATCH_MAX) },
      { filename: "binary.png" },
    ],
    [],
  );
  assert.equal(detail.files[0]?.patch?.length, PATCH_MAX);
  assert.equal(detail.files[0]?.patchTruncated, true);
  assert.equal(detail.files[1]?.patchTruncated, false);
  assert.equal(detail.files[2]?.patch, undefined);
  assert.equal(detail.files[2]?.patchTruncated, false);
});

test("files stop at 50 and the flag follows changed_files", () => {
  const files = Array.from({ length: FILES_MAX + 5 }, (_, i) => ({
    filename: `f${i}.ts`,
  }));
  const cut = mapPrDetail({ ...pull, changed_files: 55 }, files, []);
  assert.equal(cut.files.length, FILES_MAX);
  assert.equal(cut.filesTruncated, true);
  const beyondPage = mapPrDetail(
    { ...pull, changed_files: 80 },
    files.slice(0, FILES_MAX),
    [],
  );
  assert.equal(beyondPage.filesTruncated, true);
  const small = mapPrDetail(pull, files.slice(0, 3), []);
  assert.equal(small.filesTruncated, false);
});

test("a merged PR reads merged and a closed one closed", () => {
  assert.equal(
    mapPrDetail(
      { ...pull, state: "closed", merged_at: "2026-09-25T10:00:00Z" },
      [],
      [],
    ).state,
    "merged",
  );
  assert.equal(
    mapPrDetail({ ...pull, state: "closed" }, [], []).state,
    "closed",
  );
  assert.equal(mapPrDetail(pull, [], []).state, "open");
});

test("fetchPrDetail reads the PR, its files and the checks on the head commit", async () => {
  const seen: string[] = [];
  mock.method(globalThis, "fetch", (input: string) => {
    const url = new URL(input);
    seen.push(url.pathname + url.search);
    const body = url.pathname.endsWith("/files")
      ? [{ filename: "a.ts", patch: "+x" }]
      : url.pathname.endsWith("/check-runs")
        ? {
            check_runs: [
              { name: "unit", status: "completed", conclusion: "failure" },
            ],
          }
        : url.pathname.endsWith("/status")
          ? { statuses: [{ context: "deploy", state: "success" }] }
          : pull;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const detail = await fetchPrDetail("t", "acme", "api", 12);
  const sha = "a".repeat(40);
  assert.deepEqual(seen, [
    "/repos/acme/api/pulls/12",
    "/repos/acme/api/pulls/12/files?per_page=50",
    `/repos/acme/api/commits/${sha}/check-runs?per_page=100`,
    `/repos/acme/api/commits/${sha}/status?per_page=100`,
  ]);
  assert.deepEqual(
    detail.checks.map((c) => [c.name, c.state]),
    [
      ["unit", "fail"],
      ["deploy", "pass"],
    ],
  );
  assert.equal(detail.headSha, sha);
  assert.equal(detail.checksTruncated, false);
});

test("fetchPrDetail flags checks past the first page of either list", async () => {
  mock.method(globalThis, "fetch", (input: string) => {
    const url = new URL(input);
    const body = url.pathname.endsWith("/files")
      ? []
      : url.pathname.endsWith("/check-runs")
        ? { total_count: 101, check_runs: [{ name: "unit" }] }
        : url.pathname.endsWith("/status")
          ? { total_count: 0, statuses: [] }
          : pull;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  const detail = await fetchPrDetail("t", "acme", "api", 12);
  assert.equal(detail.checksTruncated, true);
});

test("a check link that is not http or https is dropped", () => {
  const checks = mergeChecks(
    [{ name: "run", html_url: "javascript:alert(1)" }],
    [{ context: "status", state: "success", target_url: "ftp://ci/1" }],
  );
  assert.deepEqual(
    checks.map((c) => c.url),
    [undefined, undefined],
  );
});
