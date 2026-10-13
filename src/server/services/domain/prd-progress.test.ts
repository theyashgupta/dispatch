import test from "node:test";
import assert from "node:assert/strict";
import type { LoopProgress } from "../../../shared/types.js";
import {
  featureDir,
  featureStateFile,
  isPrdModel,
  parsePrdEngine,
  prdSlugOf,
  resumeFilePath,
} from "./prd-progress.js";

const ENGINE_ACTIVE =
  '---\nactive: true\niteration: 2\nsession_id: abc\ncompletion_promise: "RALPH COMPLETE demo-feature"\n---\nExecute the PRD at /w/repo/.planning/prds/demo.md per the ralph-loop skill.\n';

void test("parsePrdEngine reads the absolute PRD path and the slug", () => {
  assert.deepEqual(parsePrdEngine(ENGINE_ACTIVE), {
    prdPath: "/w/repo/.planning/prds/demo.md",
    slug: "demo-feature",
  });
});

void test("parsePrdEngine strips trailing punctuation from the PRD path", () => {
  assert.equal(
    parsePrdEngine("Execute the PRD at /w/p/demo.md.").prdPath,
    "/w/p/demo.md",
  );
  assert.equal(
    parsePrdEngine("Execute the PRD at /w/p/demo.md;").prdPath,
    "/w/p/demo.md",
  );
});

void test("parsePrdEngine returns at once and gives null for a bare dot, quote or run of dots", () => {
  for (const tail of [".", "...", "'", '"', "`"]) {
    assert.equal(
      parsePrdEngine(`Execute the PRD at ${tail}`).prdPath,
      null,
      tail,
    );
  }
  const started = Date.now();
  parsePrdEngine(`Execute the PRD at ${".".repeat(200_000)}x`);
  assert.ok(Date.now() - started < 1_000);
});

void test("parsePrdEngine reads a backticked, quoted or parenthesised PRD path", () => {
  const expected = "repo/.planning/prds/x.md";
  for (const text of [
    "Execute the PRD at `repo/.planning/prds/x.md`.",
    "Execute the PRD at 'repo/.planning/prds/x.md'.",
    'Execute the PRD at "repo/.planning/prds/x.md",',
    "Execute the PRD at (repo/.planning/prds/x.md).",
  ]) {
    assert.equal(parsePrdEngine(text).prdPath, expected, text);
  }
});

void test("parsePrdEngine gives null without a PRD line", () => {
  assert.deepEqual(parsePrdEngine("---\nactive: true\n---\nhello"), {
    prdPath: null,
    slug: null,
  });
});

void test("parsePrdEngine refuses a slug that could escape the folder", () => {
  assert.equal(
    parsePrdEngine('completion_promise: "RALPH COMPLETE .."\n').slug,
    null,
  );
  assert.equal(
    parsePrdEngine('completion_promise: "RALPH COMPLETE a/b"\n').slug,
    null,
  );
});

void test("parsePrdEngine accepts an unquoted completion promise", () => {
  assert.equal(
    parsePrdEngine("completion_promise: RALPH COMPLETE demo-feature\n").slug,
    "demo-feature",
  );
});

void test("prdSlugOf takes the file name without the extension", () => {
  assert.equal(prdSlugOf("x/.planning/prds/demo.md"), "demo");
  assert.equal(prdSlugOf("x/.planning/prds/.md"), null);
  assert.equal(prdSlugOf("x/.planning/prds/-bad.md"), null);
});

void test("featureDir joins the planning folder and the slug", () => {
  assert.equal(
    featureDir("repo/.planning/prds/demo.md", "demo-feature"),
    "repo/.planning/demo-feature",
  );
  assert.equal(featureDir("repo/prds/demo.md", "demo-feature"), null);
});

void test("featureDir matches the planning folder only at the start or after a slash", () => {
  assert.equal(
    featureDir(".planning/prds/demo.md", "demo-feature"),
    ".planning/demo-feature",
  );
  assert.equal(featureDir("foo.planning/prds/x.md", "demo-feature"), null);
  assert.equal(
    featureDir("a/foo.planning/b/.planning/prds/x.md", "demo-feature"),
    "a/foo.planning/b/.planning/demo-feature",
  );
});

void test("resumeFilePath uses the feature folder for a relative path inside the root", () => {
  assert.equal(
    resumeFilePath("demo-feature", "repo/.planning/prds/demo.md"),
    "repo/.planning/demo-feature/resume.md",
  );
});

void test("resumeFilePath uses the group path without a PRD file, for an absolute path, a dotdot path or no planning folder", () => {
  const group = ".roadmap/demo-feature/resume.md";
  assert.equal(resumeFilePath("demo-feature"), group);
  assert.equal(
    resumeFilePath("demo-feature", "/w/repo/.planning/prds/demo.md", false),
    group,
  );
  assert.equal(
    resumeFilePath("demo-feature", "../x/.planning/prds/y.md", false),
    group,
  );
  assert.equal(
    resumeFilePath("demo-feature", "repo/prds/demo.md", false),
    group,
  );
});

void test("resumeFilePath keeps a single loop in its planning folder when the PRD path is unusable", () => {
  const single = ".planning/demo-feature/resume.md";
  assert.equal(resumeFilePath("demo-feature", undefined, true), single);
  assert.equal(
    resumeFilePath("demo-feature", "/w/repo/.planning/prds/demo.md"),
    single,
  );
  assert.equal(resumeFilePath("demo-feature", "repo/prds/demo.md"), single);
});

void test("featureStateFile answers the state file under the same conditions", () => {
  assert.equal(
    featureStateFile("demo-feature", "repo/.planning/prds/demo.md"),
    "repo/.planning/demo-feature/state.md",
  );
  assert.equal(
    featureStateFile("demo-feature", "/w/repo/.planning/prds/demo.md"),
    null,
  );
  assert.equal(
    featureStateFile("demo-feature", "../x/.planning/prds/y.md"),
    null,
  );
  assert.equal(featureStateFile("demo-feature", "repo/prds/demo.md"), null);
});

void test("isPrdModel tells a single PRD model from a roadmap ledger model", () => {
  const model = (fields: Partial<LoopProgress>) =>
    ({ slug: "demo", roadmapFile: "units.md", ...fields }) as LoopProgress;
  assert.equal(isPrdModel(model({})), false);
  assert.equal(
    isPrdModel(
      model({ roadmapFile: "", prdFile: "repo/.planning/prds/demo.md" }),
    ),
    true,
  );
  assert.equal(isPrdModel(model({ roadmapFile: "" })), true);
  assert.equal(
    isPrdModel(model({ prdFile: "repo/.planning/prds/demo.md" })),
    true,
  );
  assert.equal(isPrdModel(undefined), false);
});
