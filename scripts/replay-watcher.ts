// Golden-master replay-regression gate for the watcher's decision logic (BE-02 centerpiece). Dev
// tooling in the same category as check-invariants.mjs: it imports NO test framework, asserts nothing
// about running-app behavior, lives outside src/ (eslint-ignored, outside knip's project and
// tsconfig.include — so it draws no lint/deadcode/tsc noise), and asserts purely by process exit code.
// Run it via tsx (it resolves the `.js`-on-`.ts` ESM specifiers): `tsx scripts/replay-watcher.ts`.
//
// It freezes the CURRENT (pre-restructure) watcher decisions so the plan-11-06 internal restructure
// can be proven byte-identical by a CLOSED-SET decision diff rather than an eyeball read-through. The
// false-flip class cost four smoke reruns to kill once; only a deterministic, per-commit decision diff
// catches a silent regression.
//
// Mechanism (record-then-check):
//   --record : replay every scripts/replay-fixtures/<class>.json tick-sequence through the watcher's
//              per-tick decision surface and write <class>.golden.json = the ordered {decision, next}
//              records. Commit the golden to freeze current behavior.
//   --check  : replay the corpus identically and diff each tick's {decision, next} against the
//              committed golden. Empty diff over all fixtures -> exit 0; any diff -> exit 1.
//
// Decision surface: the harness replays through the pure core decideScan (scan-decision.ts) AND the
// two shell PRE-DECISION guards the watcher applies before it (a To Do card is never scanned; the `※`
// recap overlay makes the tick a no-op — pane-view.ts isRecapOverlay). Both guards leave every
// per-session map untouched (next = prev). Modeling them here is what lets the recap/idle guard classes
// record their true "nothing, maps untouched" arc instead of a false-flip the raw core would produce —
// so the gate freezes the WATCHER's decisions (guards + core), which is exactly the equivalence BE-02
// requires. Geometry is threaded through paneNeedsSize exactly like the shell's lazy paneSize fetch:
// each tick starts as a NaN-geometry probe and the fixture's real width/height substitute in ONLY when
// paneNeedsSize(probe) says the shell would have probed — so paneNeedsSize is itself part of the
// frozen surface, and any drift between it and decideScan's geometry-reading branches shows up as a
// golden diff instead of a silent NaN where real geometry was expected. A null width/height still
// models a session that vanished mid-tick -> NaN, exactly what the shell passes when paneSize throws.
//
// NON-GOAL: the shell's I/O-outcome paths — capture failure (warn-once), the 3-strike dead-session
// detector (markSessionLost), and end-of-tick reapDeadSessions — are unrepresentable in the fixture
// schema (they are subprocess/store outcomes, not pane-decision inputs) and are deliberately outside
// this gate; they are covered by the phase smoke gate, not the golden.
//
// SECURITY (T-11-03): a mismatch report prints ONLY the class name, the tick index, the decision KINDS
// (a fixed enum, never agent text), and the NAMES of the differing `next` fields — never any fixture
// pane text, marker reason, or baseline value. Content-safe, exactly like the watcher's own diagnostic.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  decideScan,
  paneNeedsSize,
  type Decision,
  type ScanInput,
  type SessionState,
} from "../src/server/adapters/markers/scan-decision.js";
import { isRecapOverlay } from "../src/server/adapters/markers/pane-view.js";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "replay-fixtures",
);

interface Tick {
  pane: string[];
  width?: number | null;
  height?: number | null;
  column: string;
  lastMarker?: string;
}

interface Fixture {
  class: string;
  session?: string;
  covers?: string[];
  ticks: Tick[];
}

interface TickRecord {
  decision: Decision;
  next: SessionState;
}

/** null / missing geometry -> NaN (the sentinel the shell passes when it never fetched geometry, or
 *  when its paneSize probe threw because the session vanished between capture and size). */
function geometry(value: number | null | undefined): number {
  return value == null ? Number.NaN : value;
}

/** Replay one fixture's tick sequence, seeding empty SessionState and threading each tick's `next` as
 *  the next tick's `prev` — the watcher's per-tick decision surface (shell guards + pure core). */
function replay(fixture: Fixture): TickRecord[] {
  let prev: SessionState = { markerFreeStreak: 0 };
  const records: TickRecord[] = [];
  for (const tick of fixture.ticks) {
    const pane = tick.pane.join("\n");
    let record: TickRecord;
    if (tick.column === "todo" || isRecapOverlay(pane)) {
      // Shell pre-decision guards: a To Do card is never scanned, and the `※` recap overlay makes the
      // tick a no-op. Both leave every per-session map untouched.
      record = { decision: { kind: "nothing" }, next: prev };
    } else {
      // Mirror the shell's lazy geometry fetch: probe with NaN geometry and substitute the fixture's
      // real width/height ONLY when paneNeedsSize says the shell would have probed — freezing the
      // paneNeedsSize/decideScan geometry parity into the golden (drift = NaN where real geometry was
      // expected = a decision diff, never a silent pass).
      const probe: ScanInput = {
        pane,
        width: Number.NaN,
        height: Number.NaN,
        column: tick.column,
        lastMarker: tick.lastMarker,
      };
      const useGeometry = paneNeedsSize(probe);
      const input: ScanInput = {
        ...probe,
        width: useGeometry ? geometry(tick.width) : Number.NaN,
        height: useGeometry ? geometry(tick.height) : Number.NaN,
      };
      record = decideScan(input, prev);
    }
    records.push(record);
    prev = record.next;
  }
  return records;
}

/** Deterministic JSON with recursively sorted object keys, so a diff is order-independent. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val as globalThis.Record<string, unknown>).sort(
            ([a], [b]) => (a < b ? -1 : 1),
          ),
        )
      : val,
  );
}

/** Sorted list of the top-level `next` field NAMES whose subtree differs (values never emitted). */
function changedNextFields(
  golden: SessionState,
  actual: SessionState,
): string[] {
  const fields = ["flip", "agentView", "markerFreeStreak"] as const;
  return fields.filter(
    (field) => canonical(golden[field]) !== canonical(actual[field]),
  );
}

function fixtureFiles(): string[] {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith(".json") && !name.endsWith(".golden.json"))
    .sort();
}

function readFixture(file: string): Fixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as Fixture;
}

function goldenPath(file: string): string {
  return join(FIXTURE_DIR, file.replace(/\.json$/, ".golden.json"));
}

function record(): void {
  for (const file of fixtureFiles()) {
    const fixture = readFixture(file);
    const records = replay(fixture);
    writeFileSync(goldenPath(file), JSON.stringify(records, null, 2) + "\n");
    console.log(`recorded ${fixture.class} (${records.length} ticks)`);
  }
}

function check(): void {
  const files = fixtureFiles();
  let failures = 0;
  for (const file of files) {
    const fixture = readFixture(file);
    let golden: TickRecord[];
    try {
      golden = JSON.parse(
        readFileSync(goldenPath(file), "utf8"),
      ) as TickRecord[];
    } catch {
      console.error(`MISSING GOLDEN ${fixture.class} — run --record`);
      failures++;
      continue;
    }
    const actual = replay(fixture);
    if (actual.length !== golden.length) {
      console.error(
        `LENGTH ${fixture.class}: golden ${golden.length} ticks, replay produced ${actual.length}`,
      );
      failures++;
      continue;
    }
    for (let i = 0; i < actual.length; i++) {
      if (canonical(actual[i]) === canonical(golden[i])) continue;
      const fields = changedNextFields(golden[i].next, actual[i].next);
      console.error(
        `MISMATCH ${fixture.class} tick ${i}: decision golden.kind=${golden[i].decision.kind} ` +
          `actual.kind=${actual[i].decision.kind}; next-fields-changed=[${fields.join(",")}]`,
      );
      failures++;
    }
  }
  if (failures === 0) {
    console.log(
      `PASS: replay decisions match the golden over ${files.length} fixtures`,
    );
    process.exit(0);
  }
  console.error(
    `FAIL: ${failures} decision divergence(s) from the recorded golden`,
  );
  process.exit(1);
}

if (process.argv.includes("--help")) {
  console.log(
    "usage: tsx scripts/replay-watcher.ts [--record | --check]\n" +
      "  --record  replay the fixture corpus and (re)write each <class>.golden.json\n" +
      "  --check   replay the corpus and diff decisions against the committed golden (exit 1 on any diff)",
  );
  process.exit(0);
} else if (process.argv.includes("--record")) {
  record();
} else if (process.argv.includes("--check")) {
  check();
} else {
  console.error("usage: tsx scripts/replay-watcher.ts [--record | --check]");
  process.exit(2);
}
