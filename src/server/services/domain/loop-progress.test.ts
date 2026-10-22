import test from "node:test";
import assert from "node:assert/strict";
import type { LoopProgress } from "../../../shared/types.js";
import { parsePrdEngine } from "./prd-progress.js";
import {
  buildLoopProgress,
  buildPrdProgress,
  closedEngineText,
  type PrdProgressInput,
  parseAttemptLines,
  parseEngineFile,
  parseProgressFile,
  parsePhases,
  parseRoadmap,
  parseStateLines,
  phaseDir,
  unitFilePaths,
  withClosedReason,
} from "./loop-progress.js";

const READ_AT = "2026-10-06T12:00:00.000Z";
const ROADMAP_ONE = "### Unit 1: A\n- **Status:** not started\n";
const PROGRESS_OK = "| Unit | Status |\n| - | - |\n| 1 | pending |\n";

void test("a handoff-pending session id sets handoffPending", () => {
  const parsed = parseEngineFile(
    '---\nactive: true\niteration: 3\nsession_id: handoff-pending\nstarted_at: "2026-10-06T00:00:00Z"\n---\nbody',
    false,
  );
  assert.equal(parsed.engine?.handoffPending, true);
  assert.equal(parsed.engine?.startedAt, "2026-10-06T00:00:00Z");
});

void test("a status with trailing detail keeps the base status", () => {
  const [unit] = parseRoadmap(
    "### Unit 1: A\n- **Status:** built, awaiting /ship (branch x, commits a, b)\n- **PRD:** `p/.planning/prds/s-unit-1.md` (2 phases)\n",
  ).units;
  assert.equal(unit?.status, "built, awaiting /ship");
  assert.equal(
    unit?.statusText,
    "built, awaiting /ship (branch x, commits a, b)",
  );
  assert.equal(unit?.prdPath, "p/.planning/prds/s-unit-1.md");
});

void test("an unknown status gives unknown and keeps the raw text", () => {
  const [unit] = parseRoadmap(
    "### Unit 4: D\n- **Status:** paused for review\n- **PRD:** none yet\n",
  ).units;
  assert.equal(unit?.status, "unknown");
  assert.equal(unit?.statusText, "paused for review");
  assert.equal(unit?.prdPath, null);
});

void test("a malformed engine text gives a warning and a null engine", () => {
  const result = buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText: ROADMAP_ONE,
    progressText: PROGRESS_OK,
    engine: { text: "no front matter here", closed: false },
    files: new Map(),
    refused: new Set(),
    warnings: [],
  });
  assert.equal(result.engine, null);
  assert.deepEqual(result.warnings, [
    ".claude/ralph-loop.local.md: no front matter",
  ]);
});

void test("a PRD with no phase headings gives a null total and a warning", () => {
  const roadmapText =
    "### Unit 1: A\n- **Status:** not started\n- **PRD:** `d/.planning/prds/s-unit-1.md`\n";
  const result = buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText,
    progressText: PROGRESS_OK,
    engine: null,
    files: new Map([
      ["d/.planning/prds/s-unit-1.md", "# only a title\n"],
      ["d/.planning/s-unit-1/state.md", null],
      ["d/.planning/s-unit-1/attempts.md", null],
    ]),
    refused: new Set(),
    warnings: [],
  });
  assert.equal(result.units[0]?.phaseTotal, null);
  assert.deepEqual(result.units[0]?.phases, []);
  assert.deepEqual(result.warnings, [
    "d/.planning/prds/s-unit-1.md: no phase headings",
  ]);
});

void test("a missing PRD warns and a missing attempts file never does", () => {
  const roadmapText =
    "### Unit 1: A\n- **Status:** in progress\n- **PRD:** `d/.planning/prds/s-unit-1.md`\n";
  const result = buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText,
    progressText: PROGRESS_OK,
    engine: null,
    files: new Map([
      ["d/.planning/prds/s-unit-1.md", null],
      [
        "d/.planning/s-unit-1/state.md",
        "phase 1 x GREEN 2026-10-06T00:00:00Z gate=pass\n",
      ],
      ["d/.planning/s-unit-1/attempts.md", null],
    ]),
    refused: new Set(),
    warnings: [],
  });
  assert.deepEqual(result.warnings, ["d/.planning/prds/s-unit-1.md: missing"]);
});

void test("a null progress text warns with the progress path", () => {
  const result = buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText: ROADMAP_ONE,
    progressText: null,
    engine: null,
    files: new Map(),
    refused: new Set(),
    warnings: ["carried"],
  });
  assert.deepEqual(result.warnings, [
    "carried",
    ".roadmap/s/progress.md: missing",
  ]);
  assert.equal(result.completion, "not_started");
});

void test("a PRD path without a planning folder gives no phase paths", () => {
  const roadmapText =
    "### Unit 1: A\n- **Status:** in progress\n- **PRD:** `docs/prd.md`\n";
  const paths = unitFilePaths(roadmapText, "s");
  assert.deepEqual(paths.paths, ["docs/prd.md"]);
  assert.equal(paths.warnings.length, 1);
});

void test("the progress table is read by header name in any column order", () => {
  const parsed = parseProgressFile(
    [
      "Roadmap: /r/ROADMAP.md, slug s",
      "",
      "| Status | Branch | Unit |",
      "| - | - | - |",
      "| committed abcdef1 | feat/LOCAL-9-x (from y) | 1 |",
      "| pending | - | 2 |",
      "| broken row |",
    ].join("\n"),
  );
  assert.equal(parsed.roadmapPath, "/r/ROADMAP.md");
  assert.deepEqual(parsed.units.get(1), {
    ticket: "LOCAL-9",
    branch: "feat/LOCAL-9-x",
    statusText: "committed abcdef1",
    commit: "abcdef1",
  });
  assert.equal(parsed.units.get(2)?.branch, null);
  assert.equal(parsed.units.size, 2);
});

void test("state and attempt lines parse and ignore other lines", () => {
  assert.deepEqual(
    parseStateLines(
      "phase 2 Name with GREEN word GREEN 2026-10-06T01:00:00Z gate=pass\nnoise\n",
    ),
    [{ phase: 2, at: "2026-10-06T01:00:00Z" }],
  );
  assert.deepEqual(
    parseAttemptLines("phase 3 RED attempt 2 2026-10-06T02:00:00Z (why)\nx\n"),
    [{ phase: 3, attempt: 2, at: "2026-10-06T02:00:00Z" }],
  );
  assert.deepEqual(
    parsePhases("### Phase 1: A (no-budget)\n### Phase 2: B").phases,
    [
      { number: 1, name: "A (no-budget)", retryBudget: null },
      { number: 2, name: "B", retryBudget: null },
    ],
  );
});

void test("parsePhases reads the first retry budget line under each heading", () => {
  const text = [
    "- **Retry budget:** 9",
    "### Phase 1: A",
    "- **Retry budget:** 3 (largest switch)",
    "- **Retry budget:** 7",
    "### Phase 2: B",
    "text only",
    "### Phase 3: C",
    "#### Notes",
    "- **Retry budget:** 5",
    "### Phase 4: D",
    "- **Retry budget:** 2",
    "### Phase 5: E",
    "- **Retry budget:** 1000",
  ].join("\n");
  assert.deepEqual(
    parsePhases(text).phases.map((phase) => phase.retryBudget),
    [3, null, null, 2, null],
  );
});

void test("an empty file and a binary-looking string never throw", () => {
  const junk = "\u0000\u0001�|||\n### Unit x\n---\n\u0000".repeat(50);
  for (const text of ["", junk]) {
    const result = buildLoopProgress({
      slug: "s",
      roadmapFile: "ROADMAP.md",
      readAt: READ_AT,
      roadmapText: text,
      progressText: text,
      engine: { text, closed: true },
      files: new Map(),
      refused: new Set(),
      warnings: [],
    });
    assert.equal(result.units.length, 0);
    assert.equal(result.completion, "not_started");
    assert.equal(result.summary.lastGate, null);
  }
});

interface Overrides {
  roadmapText?: string | null;
  refused?: string[];
  progressText?: string | null;
  engine?: { text: string; closed: boolean } | null;
  files?: [string, string | null][];
}

function build(overrides: Overrides): LoopProgress {
  return buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText:
      overrides.roadmapText === undefined ? ROADMAP_ONE : overrides.roadmapText,
    progressText:
      overrides.progressText === undefined
        ? PROGRESS_OK
        : overrides.progressText,
    engine: overrides.engine ?? null,
    files: new Map(overrides.files ?? []),
    refused: new Set(overrides.refused ?? []),
    warnings: [],
  });
}

const PRD_UNIT =
  "### Unit 1: A\n- **Status:** in progress\n- **PRD:** `d/.planning/prds/s-unit-1.md`\n";

void test("an empty file gives an empty warning and nothing else", () => {
  assert.deepEqual(
    build({
      roadmapText: "  \n",
      progressText: "",
      engine: { text: " ", closed: false },
    }).warnings,
    [
      "ROADMAP.md: empty",
      ".roadmap/s/progress.md: empty",
      ".claude/ralph-loop.local.md: empty",
    ],
  );
  assert.deepEqual(
    build({
      roadmapText: PRD_UNIT,
      files: [
        ["d/.planning/prds/s-unit-1.md", ""],
        ["d/.planning/s-unit-1/state.md", "\n"],
        ["d/.planning/s-unit-1/attempts.md", " "],
      ],
    }).warnings,
    [
      "d/.planning/prds/s-unit-1.md: empty",
      "d/.planning/s-unit-1/state.md: empty",
      "d/.planning/s-unit-1/attempts.md: empty",
    ],
  );
});

void test("a NUL or a control-heavy text gives a not text warning", () => {
  const control = "\u0001\u0002\u0003abcdefghij";
  assert.deepEqual(
    build({
      roadmapText: "### Unit 1: A\u0000",
      progressText: control,
      engine: { text: "---\u0000\n---", closed: true },
    }).warnings,
    [
      "ROADMAP.md: not text",
      ".roadmap/s/progress.md: not text",
      ".claude/ralph-loop.local.md.done: not text",
    ],
  );
  assert.deepEqual(
    build({
      roadmapText: PRD_UNIT,
      files: [["d/.planning/prds/s-unit-1.md", "### Phase 1: A\u0000"]],
    }).warnings.slice(0, 1),
    ["d/.planning/prds/s-unit-1.md: not text"],
  );
});

void test("tab, CR and LF do not make a text binary", () => {
  assert.deepEqual(
    build({ roadmapText: "\t\r\n\t\r\n### Unit 1: A\r\n" }).warnings,
    [],
  );
});

void test("a roadmap with no unit headings gives a warning", () => {
  assert.deepEqual(build({ roadmapText: "# Title\nno units\n" }).warnings, [
    "ROADMAP.md: no unit headings",
  ]);
});

void test("a progress file reports a missing table and malformed rows", () => {
  assert.deepEqual(build({ progressText: "just prose\n" }).warnings, [
    ".roadmap/s/progress.md: no units table",
  ]);
  const table = [
    "Roadmap: /r/ROADMAP.md, slug s",
    "| Unit | Status |",
    "| :- | -: |",
    "| 1 | pending |",
    "| x | pending |",
    "| 2 | pending | extra |",
  ].join("\n");
  assert.deepEqual(build({ progressText: table }).warnings, [
    ".roadmap/s/progress.md: malformed row 5",
    ".roadmap/s/progress.md: malformed row 6",
  ]);
  const parsed = parseProgressFile(table);
  assert.deepEqual([...parsed.units.keys()], [1]);
  assert.deepEqual(parsed.warnings, ["malformed row 5", "malformed row 6"]);
});

void test("a roadmap Status line branch names the unit branch when the ledger has no units table", () => {
  const unit = (n: number, title: string, branch: string) =>
    `### Unit ${n}: ${title}\n- **Status:** built, awaiting /ship (branch \`${branch}\`, 8073bafe, 676d3279)\n`;
  const result = build({
    roadmapText: [
      unit(
        1,
        "Dashboards dropdown",
        "feat/LOCAL-131-unit-1-dashboards-dropdown",
      ),
      unit(2, "Remove sessions", "feat/LOCAL-132-unit-2-remove-sessions"),
      unit(3, "Remove workspace", "feat/LOCAL-134-unit-3-remove-workspace"),
      unit(4, "Remove activity", "feat/LOCAL-130-unit-4-remove-activity"),
    ].join(""),
    progressText:
      "Roadmap: /x/ROADMAP.md, slug s\n\n## Unit statuses\n- Unit 1: committed 048f1d0d\n- Unit 2: committed 5755e79d\n- Unit 3: committed 69690ba8\n- Unit 4: committed 7b5f9c0a\n",
  });
  assert.deepEqual(
    result.units.map((u) => u.branch),
    [
      "feat/LOCAL-131-unit-1-dashboards-dropdown",
      "feat/LOCAL-132-unit-2-remove-sessions",
      "feat/LOCAL-134-unit-3-remove-workspace",
      "feat/LOCAL-130-unit-4-remove-activity",
    ],
  );
});

void test("a progress table branch wins over a roadmap Status line branch", () => {
  const result = build({
    roadmapText:
      "### Unit 1: A\n- **Status:** built, awaiting /ship (branch `feat/X-1-unit-1-status`, abc1234)\n",
    progressText:
      "| Unit | Status | Branch |\n| - | - | - |\n| 1 | committed abc1234 | feat/X-1-unit-1-table |\n",
  });
  assert.equal(result.units[0]?.branch, "feat/X-1-unit-1-table");
});

void test("an empty or dash progress table branch cell falls back to the roadmap Status line branch", () => {
  const result = build({
    roadmapText: [
      "### Unit 1: A\n- **Status:** built, awaiting /ship (branch `feat/X-1-unit-1-status`, abc1234)\n",
      "### Unit 2: B\n- **Status:** built, awaiting /ship (branch `feat/X-2-unit-2-status`, abc1234)\n",
    ].join(""),
    progressText:
      "| Unit | Status | Branch |\n| - | - | - |\n| 1 | committed abc1234 |  |\n| 2 | committed abc1234 | - |\n",
  });
  assert.deepEqual(
    result.units.map((u) => u.branch),
    ["feat/X-1-unit-1-status", "feat/X-2-unit-2-status"],
  );
});

void test("a roadmap Status line keeps branch null without a parenthesised backtick branch", () => {
  const result = build({
    roadmapText: [
      "### Unit 1: A\n- **Status:** built, awaiting /ship (branch x, commits a, b)\n",
      "### Unit 2: B\n- **Status:** built, awaiting /ship, old branch `feat/old` dropped\n",
      "### Unit 3: C\n- **Status:** built, awaiting /ship\n",
    ].join(""),
    progressText: "Roadmap: /x/R.md, slug s\n",
  });
  assert.deepEqual(
    result.units.map((u) => u.branch),
    [null, null, null],
  );
});

void test("an engine with front matter and no active field gives a warning", () => {
  const result = build({
    engine: { text: "---\niteration: 2\n---\n", closed: false },
  });
  assert.equal(result.engine, null);
  assert.deepEqual(result.warnings, [
    ".claude/ralph-loop.local.md: no active field",
  ]);
});

void test("a refused path adds no missing or empty warning", () => {
  assert.deepEqual(
    build({
      roadmapText: null,
      progressText: null,
      refused: ["ROADMAP.md", ".roadmap/s/progress.md"],
    }).warnings,
    [],
  );
  assert.deepEqual(build({ roadmapText: null }).warnings, [
    "ROADMAP.md: missing",
  ]);
  assert.equal(build({ roadmapText: null }).units.length, 0);
  assert.deepEqual(
    build({
      roadmapText: PRD_UNIT,
      refused: [
        "d/.planning/prds/s-unit-1.md",
        "d/.planning/s-unit-1/state.md",
      ],
      files: [
        ["d/.planning/prds/s-unit-1.md", null],
        ["d/.planning/s-unit-1/state.md", null],
      ],
    }).warnings,
    [],
  );
});

void test("phaseDir keeps the prefix before the planning folder", () => {
  assert.equal(
    phaseDir("d/.planning/prds/s-unit-1.md", "s", 1),
    "d/.planning/s-unit-1",
  );
  assert.equal(phaseDir(".planning/p.md", "s", 3), ".planning/s-unit-3");
  assert.equal(phaseDir("docs/prd.md", "s", 1), null);
});

void test("warnings are capped at 50 entries and 300 characters", () => {
  const rows = Array.from({ length: 60 }, (_, index) => `| x${index} | a |`);
  const table = ["| Unit | Status |", "| - | - |", ...rows].join("\n");
  const result = build({ progressText: table });
  assert.equal(result.warnings.length, 50);
  assert.equal(result.warnings[48], ".roadmap/s/progress.md: malformed row 51");
  assert.equal(result.warnings[49], "11 more warnings");

  const long = buildLoopProgress({
    slug: "s",
    roadmapFile: `${"R".repeat(400)}.md`,
    readAt: READ_AT,
    roadmapText: "# Title\n",
    progressText: PROGRESS_OK,
    engine: null,
    files: new Map(),
    refused: new Set(),
    warnings: [],
  });
  assert.equal(long.warnings[0]?.length, 300);
  assert.ok(long.warnings[0]?.endsWith("..."));
});

void test("a long whitespace run before a trailing character parses fast on every line shape", () => {
  const pad = " ".repeat(200_000);
  const cases: [string, () => unknown][] = [
    ["unit heading", () => parseRoadmap(`### Unit 1: ${pad}x`).units],
    [
      "status line",
      () => parseRoadmap(`### Unit 1: A\n- **Status:** ${pad}x`).units,
    ],
    ["phase heading", () => parsePhases(`### Phase 1: ${pad}x`).phases],
    [
      "engine field",
      () => parseEngineFile(`---\nactive: ${pad}x\n---\nbody`, false),
    ],
  ];
  for (const [name, run] of cases) {
    const startedAt = performance.now();
    assert.doesNotThrow(run, name);
    assert.ok(performance.now() - startedAt < 200, `${name} took too long`);
  }
});

void test("whitespace with a lone carriage return or line separator parses fast", () => {
  for (const tail of ["x\ry", "x\u2028y", "x\u2029y"]) {
    const pad = " ".repeat(200_000) + tail;
    const cases: [string, () => unknown][] = [
      ["unit heading", () => parseRoadmap(`### Unit 1: ${pad}`).units],
      [
        "status line",
        () => parseRoadmap(`### Unit 1: A\n- **Status:**${pad}`).units,
      ],
      ["prd line", () => parseRoadmap(`### Unit 1: A\n- **PRD:**${pad}`).units],
      ["phase heading", () => parsePhases(`### Phase 1: ${pad}`).phases],
      [
        "engine field",
        () => parseEngineFile(`---\nactive:${pad}\n---\nbody`, false),
      ],
    ];
    for (const [name, run] of cases) {
      const startedAt = performance.now();
      assert.doesNotThrow(run, name);
      assert.ok(performance.now() - startedAt < 200, `${name} took too long`);
    }
  }
});

void test("the unit and phase caps keep the first 99 and warn once", () => {
  const units = Array.from(
    { length: 100 },
    (_, index) =>
      `### Unit ${index + 1}: U${index + 1}\n- **Status:** shipped\n`,
  ).join("");
  assert.equal(parseRoadmap(units).units.length, 99);
  const unitResult = buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText: units,
    progressText: PROGRESS_OK,
    engine: null,
    files: new Map(),
    refused: new Set(),
    warnings: [],
  });
  assert.equal(unitResult.units.length, 99);
  assert.equal(
    unitResult.warnings.filter((warning) => warning.includes("more than 99"))
      .length,
    1,
  );
  assert.ok(
    unitResult.warnings.includes(
      "ROADMAP.md: more than 99 units, the rest are skipped",
    ),
  );

  const prd = Array.from(
    { length: 100 },
    (_, index) => `### Phase ${index + 1}: P${index + 1}\n`,
  ).join("");
  assert.equal(parsePhases(prd).phases.length, 99);
  const prdPath = "d/.planning/prds/s-unit-1.md";
  const phaseResult = buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText: `### Unit 1: A\n- **Status:** not started\n- **PRD:** \`${prdPath}\`\n`,
    progressText: PROGRESS_OK,
    engine: null,
    files: new Map([[prdPath, prd]]),
    refused: new Set(),
    warnings: [],
  });
  assert.equal(phaseResult.units[0]?.phaseTotal, 99);
  assert.ok(
    phaseResult.warnings.includes(
      `${prdPath}: more than 99 phases, the rest are skipped`,
    ),
  );
});

void test("headings with a number of five digits are not units or phases", () => {
  assert.equal(parseRoadmap("### Unit 12345: A\n").units.length, 0);
  assert.equal(parsePhases("### Phase 12345: A\n").phases.length, 0);
});

void test("lastGate falls back to the newest done unit when the current unit has no lines", () => {
  const roadmapText = [
    "### Unit 1: A",
    "- **Status:** built, awaiting /ship",
    "- **PRD:** `d/.planning/prds/s-unit-1.md`",
    "### Unit 2: B",
    "- **Status:** in progress",
    "- **PRD:** `d/.planning/prds/s-unit-2.md`",
    "",
  ].join("\n");
  const result = buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText,
    progressText: PROGRESS_OK,
    engine: null,
    files: new Map([
      ["d/.planning/prds/s-unit-1.md", "### Phase 1: One\n"],
      [
        "d/.planning/s-unit-1/state.md",
        "phase 1 One GREEN 2026-10-06T00:00:00Z gate=pass\n",
      ],
      ["d/.planning/s-unit-1/attempts.md", null],
      ["d/.planning/prds/s-unit-2.md", "### Phase 1: Two\n"],
      ["d/.planning/s-unit-2/state.md", null],
      ["d/.planning/s-unit-2/attempts.md", null],
    ]),
    refused: new Set(),
    warnings: [],
  });
  assert.equal(result.summary.currentUnit, 2);
  assert.deepEqual(result.summary.lastGate, {
    unit: 1,
    phase: 1,
    result: "pass",
    at: "2026-10-06T00:00:00Z",
  });
});

test("an attempt line with an unparseable time is dropped", () => {
  assert.deepEqual(parseAttemptLines("phase 3 RED attempt 2 garbage\n"), []);
});

test("a pass line with an unparseable time is kept with a null time", () => {
  assert.deepEqual(parseStateLines("phase 2 Name GREEN garbage gate=pass\n"), [
    { phase: 2, at: null },
  ]);
});

test("a pass line with a bad time still passes the phase and hides its older RED attempt", () => {
  const result = buildLoopProgress({
    slug: "s",
    roadmapFile: "ROADMAP.md",
    readAt: READ_AT,
    roadmapText: [
      "### Unit 1: A",
      "- **Status:** in progress",
      "- **PRD:** `d/.planning/prds/s-unit-1.md`",
      "",
    ].join("\n"),
    progressText: PROGRESS_OK,
    engine: null,
    files: new Map([
      ["d/.planning/prds/s-unit-1.md", "### Phase 1: One\n"],
      [
        "d/.planning/s-unit-1/state.md",
        "phase 1 One GREEN not-a-time gate=pass\n",
      ],
      [
        "d/.planning/s-unit-1/attempts.md",
        "phase 1 RED attempt 1 2026-10-05T00:00:00Z\n",
      ],
    ]),
    refused: new Set(),
    warnings: [],
  });
  const phase = result.units[0]?.phases[0];
  assert.equal(phase?.gate, "pass");
  assert.equal(phase?.passedAt, null);
  assert.equal(result.summary.lastGate, null);
});

const PRD_READ_AT = "2026-10-11T06:00:00.000Z";
const PRD_FILE = "repo/.planning/prds/demo.md";
const STATE_PATH = "repo/.planning/demo-feature/state.md";
const ATTEMPTS_PATH = "repo/.planning/demo-feature/attempts.md";
const PRD_THREE =
  "# Demo feature\n\n### Phase 1: One\n\n### Phase 2: Two\n\n### Phase 3: Three\n";
const ENGINE_ACTIVE =
  '---\nactive: true\niteration: 2\nsession_id: abc\ncompletion_promise: "RALPH COMPLETE demo-feature"\n---\nExecute the PRD at /w/repo/.planning/prds/demo.md per the ralph-loop skill.\n';

function prdInput(over: Partial<PrdProgressInput> = {}): PrdProgressInput {
  return {
    slug: "demo-feature",
    prdFile: PRD_FILE,
    readAt: PRD_READ_AT,
    prdText: PRD_THREE,
    statePath: STATE_PATH,
    stateText: null,
    attemptsPath: ATTEMPTS_PATH,
    attemptsText: null,
    engine: null,
    refused: new Set(),
    warnings: [],
    ...over,
  };
}

void test("no gate line and no running engine gives not started", () => {
  const result = buildPrdProgress(prdInput());
  assert.equal(result.units[0]?.status, "not started");
  assert.equal(result.completion, "not_started");
  assert.equal(result.summary.currentUnit, null);
  assert.equal(result.summary.currentPhase, null);
  assert.equal(result.summary.lastGate, null);
  assert.deepEqual(result.warnings, []);
});

void test("one pass and one RED attempt give a running unit", () => {
  const result = buildPrdProgress(
    prdInput({
      stateText: "phase 1 One GREEN 2026-10-11T04:00:00Z gate=pass\n",
      attemptsText: "phase 2 RED attempt 1 2026-10-11T05:00:00Z\n",
    }),
  );
  const unit = result.units[0];
  assert.deepEqual(
    unit?.phases.map((phase) => [phase.gate, phase.attempts]),
    [
      ["pass", 0],
      ["fail", 1],
      ["pending", 0],
    ],
  );
  assert.equal(unit?.status, "in progress");
  assert.equal(result.completion, "running");
  assert.equal(result.summary.currentUnit, 1);
  assert.deepEqual(result.summary.currentPhase, { number: 2, name: "Two" });
  assert.deepEqual(result.summary.lastGate, {
    unit: 1,
    phase: 2,
    result: "fail",
    at: "2026-10-11T05:00:00Z",
  });
});

void test("all phases passed gives a built unit", () => {
  const result = buildPrdProgress(
    prdInput({
      stateText:
        "phase 1 One GREEN 2026-10-11T04:00:00Z gate=pass\nphase 2 Two GREEN 2026-10-11T05:00:00Z gate=pass\nphase 3 Three GREEN 2026-10-11T06:00:00Z gate=pass\n",
    }),
  );
  assert.equal(result.units[0]?.status, "built, awaiting /ship");
  assert.equal(result.completion, "complete");
  assert.equal(result.summary.unitsDone, 1);
  assert.equal(result.summary.unitsTotal, 1);
  assert.equal(result.summary.currentUnit, null);
  assert.equal(result.summary.currentPhase, null);
  assert.equal(result.summary.lastGate?.phase, 3);
});

void test("an active engine with no gate line gives in progress", () => {
  const result = buildPrdProgress(
    prdInput({ engine: { text: ENGINE_ACTIVE, closed: false } }),
  );
  assert.equal(result.units[0]?.status, "in progress");
  assert.equal(result.completion, "running");
  assert.equal(result.engine?.active, true);
  assert.deepEqual(result.summary.currentPhase, { number: 1, name: "One" });
});

void test("a closed engine with no gate lines gives not started", () => {
  const result = buildPrdProgress(
    prdInput({ engine: { text: ENGINE_ACTIVE, closed: true } }),
  );
  assert.equal(result.units[0]?.status, "not started");
  assert.equal(result.completion, "not_started");
  assert.equal(result.engine?.closed, true);
});

void test("a closed engine with no PRD file reads built and complete", () => {
  const result = buildPrdProgress(
    prdInput({
      prdFile: null,
      prdText: null,
      engine: { text: ENGINE_ACTIVE, closed: true },
    }),
  );
  assert.equal(result.units[0]?.status, "built, awaiting /ship");
  assert.equal(result.completion, "complete");
  assert.equal(result.summary.unitsDone, 1);
  assert.equal(result.summary.unitsTotal, 1);
});

void test("an open engine with no PRD file reads running, not complete", () => {
  const result = buildPrdProgress(
    prdInput({
      prdFile: null,
      prdText: null,
      engine: { text: ENGINE_ACTIVE, closed: false },
    }),
  );
  assert.equal(result.completion, "running");
});

void test("a closed engine with phases read stays in progress while a phase is pending", () => {
  const result = buildPrdProgress(
    prdInput({
      stateText: "phase 1 One GREEN 2026-10-11T04:00:00Z gate=pass\n",
      engine: { text: ENGINE_ACTIVE, closed: true },
    }),
  );
  assert.equal(result.units[0]?.status, "in progress");
  assert.notEqual(result.completion, "complete");
});

void test("a PRD with no phase headings gives a warning and a null total", () => {
  const result = buildPrdProgress(prdInput({ prdText: "# Only a title\n" }));
  assert.equal(result.units[0]?.phaseTotal, null);
  assert.deepEqual(result.units[0]?.phases, []);
  assert.deepEqual(result.warnings, [`${PRD_FILE}: no phase headings`]);
});

void test("a null PRD text gives the missing warning", () => {
  const result = buildPrdProgress(prdInput({ prdText: null }));
  assert.deepEqual(result.warnings, [`${PRD_FILE}: missing`]);
  assert.equal(result.units[0]?.title, "demo-feature");
});

void test("a null PRD file gives no prdFile key, no missing warning and no phases", () => {
  const result = buildPrdProgress(prdInput({ prdFile: null, prdText: null }));
  assert.equal("prdFile" in result, false);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.units[0]?.phases, []);
  assert.equal(result.units[0]?.prdPath, null);
});

void test("the title is the first heading line and falls back to the slug", () => {
  assert.equal(buildPrdProgress(prdInput()).units[0]?.title, "Demo feature");
  assert.equal(
    buildPrdProgress(prdInput({ prdText: "### Phase 1: One\n" })).units[0]
      ?.title,
    "demo-feature",
  );
});

void test("the model has no roadmap file and carries the PRD file", () => {
  const result = buildPrdProgress(prdInput());
  assert.equal(result.roadmapFile, "");
  assert.equal(result.prdFile, PRD_FILE);
  assert.equal(result.slug, "demo-feature");
  assert.equal(result.units[0]?.prdPath, PRD_FILE);
  assert.equal(result.readAt, PRD_READ_AT);
});

const FENCED = "---\nactive: true\niteration: 2\n---\nbody line\n";

void test("withClosedReason inserts the reason before the second fence and keeps the body", () => {
  assert.equal(
    withClosedReason(FENCED, "promise"),
    "---\nactive: true\niteration: 2\nclosed_reason: promise\n---\nbody line\n",
  );
});

void test("withClosedReason replaces an existing closed_reason line", () => {
  const text = "---\nactive: true\nclosed_reason: promise\n---\nbody\n";
  assert.equal(
    withClosedReason(text, "close_loop"),
    "---\nactive: true\nclosed_reason: close_loop\n---\nbody\n",
  );
});

void test("withClosedReason returns text without a front matter unchanged", () => {
  assert.equal(withClosedReason("no fences\n", "promise"), "no fences\n");
  assert.equal(
    withClosedReason("---\nactive: true\n", "promise"),
    "---\nactive: true\n",
  );
});

void test("a closed engine file reports the closed_reason it holds", () => {
  for (const reason of ["promise", "close_loop"]) {
    const text = `---\nactive: true\nclosed_reason: ${reason}\n---\nbody`;
    assert.equal(parseEngineFile(text, true).engine?.closedReason, reason);
  }
});

void test("a closed engine file with no or an unknown closed_reason reports manual", () => {
  assert.equal(parseEngineFile(FENCED, true).engine?.closedReason, "manual");
  assert.equal(
    parseEngineFile("---\nactive: true\nclosed_reason: other\n---\nbody", true)
      .engine?.closedReason,
    "manual",
  );
});

void test("an open engine file has no closedReason key", () => {
  const text = "---\nactive: true\nclosed_reason: promise\n---\nbody";
  assert.equal(
    "closedReason" in (parseEngineFile(text, false).engine ?? {}),
    false,
  );
});

void test("closedEngineText parses as a closed engine with the reason and the session id", () => {
  const text = closedEngineText("local-172", "sess-1", "promise");
  const { engine } = parseEngineFile(text, true);
  assert.equal(engine?.active, false);
  assert.equal(engine?.closed, true);
  assert.equal(engine?.closedReason, "promise");
  assert.equal(engine?.sessionId, "sess-1");
  assert.equal(parsePrdEngine(text).slug, "local-172");
});

void test("closedEngineText leaves the session id null when none is given", () => {
  const { engine } = parseEngineFile(
    closedEngineText("local-172", null, "close_loop"),
    true,
  );
  assert.equal(engine?.sessionId, null);
  assert.equal(engine?.closedReason, "close_loop");
});

void test("a slot give-up line from the gate leaves the phase attempt count unchanged", () => {
  const counts = (attemptsText: string) =>
    buildPrdProgress(
      prdInput({
        stateText: "phase 1 One GREEN 2026-10-22T04:00:00Z gate=pass\n",
        attemptsText,
      }),
    ).units[0]?.phases.map((phase) => [phase.gate, phase.attempts]);
  assert.deepEqual(counts("phase 2 SLOT gave up 2026-10-22T05:00:00Z\n"), [
    ["pass", 0],
    ["pending", 0],
    ["pending", 0],
  ]);
  assert.deepEqual(
    counts(
      "phase 2 RED attempt 1 2026-10-22T05:00:00Z\nphase 2 SLOT gave up 2026-10-22T06:00:00Z\n",
    ),
    [
      ["pass", 0],
      ["fail", 1],
      ["pending", 0],
    ],
  );
});
