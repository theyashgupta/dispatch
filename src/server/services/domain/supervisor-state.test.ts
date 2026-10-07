import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  detectState,
  initialMemory,
  paneReady,
  type DetectInput,
  type Detection,
  paneBusy,
} from "./supervisor-state.js";
import type { SupervisorState } from "../../../shared/types.js";

const PANES = new URL("../../test-support/fixtures/panes/", import.meta.url);
const MINUTE = 60_000;

function pane(name: string): string {
  return readFileSync(new URL(name, PANES), "utf8");
}

function input(over: Partial<DetectInput>): DetectInput {
  return {
    now: 0,
    tmuxAlive: true,
    atShellPrompt: false,
    pane: "",
    engineSessionId: "3f0c2a7e-5d1b-4c3e-9a2f-1b2c3d4e5f60",
    completion: "running",
    transcript: null,
    memory: initialMemory(),
    ...over,
  };
}

/**
 * Feed `count` captures of `text` one minute apart and return every detection.
 *
 * @remarks `transcriptSize` maps the capture index to a transcript size, so a test can grow or
 * freeze the transcript between samples.
 */
function feed(
  text: string,
  count: number,
  over: Partial<DetectInput> = {},
  transcriptSize?: (i: number) => number,
): Detection[] {
  const out: Detection[] = [];
  let memory = over.memory ?? initialMemory();
  for (let i = 0; i < count; i++) {
    const d = detectState(
      input({
        ...over,
        now: (over.now ?? 0) + i * MINUTE,
        pane: text,
        memory,
        transcript: transcriptSize
          ? { size: transcriptSize(i), lastAssistantText: null }
          : (over.transcript ?? null),
      }),
    );
    out.push(d);
    memory = d.memory;
  }
  return out;
}

function last(ds: Detection[]): SupervisorState {
  return ds[ds.length - 1].state;
}

const FIXTURE_STATES: [
  string,
  number,
  Partial<DetectInput>,
  SupervisorState,
][] = [
  ["working.txt", 1, {}, "working"],
  ["warming-up.txt", 3, {}, "working"],
  ["warming-up-2.txt", 3, {}, "working"],
  ["idle.txt", 3, {}, "idle"],
  ["needs-input-question.txt", 1, {}, "needs_input"],
  ["permission-prompt.txt", 2, {}, "permission_prompt"],
  ["dangerous-delete.txt", 2, {}, "permission_prompt"],
  ["peer-message.txt", 2, {}, "permission_prompt"],
  [
    "handoff-ready.txt",
    1,
    { engineSessionId: "handoff-pending" },
    "handoff_ready",
  ],
  ["roadmap-complete.txt", 1, { completion: "complete" }, "roadmap_complete"],
  ["limit-menu.txt", 2, {}, "usage_limit_dialog"],
  ["limit-menu-2.txt", 2, {}, "usage_limit_dialog"],
  ["auto-continue.txt", 2, {}, "usage_limit_wait"],
  ["api-error.txt", 1, {}, "api_error"],
  ["api-error-2.txt", 1, {}, "api_error"],
  ["shell-prompt.txt", 1, { atShellPrompt: true }, "shell_prompt"],
  ["idle.txt", 1, { tmuxAlive: false }, "lost"],
];

for (const [file, count, over, state] of FIXTURE_STATES) {
  void test(`recorded pane ${file} gives ${state}`, () => {
    assert.equal(last(feed(pane(file), count, over)), state);
  });
}

void test("every one of the 12 states comes from a recorded pane", () => {
  const seen = new Set(FIXTURE_STATES.map(([, , , s]) => s));
  seen.add(last(feed(pane("working.txt"), 16, {}, () => 100)));
  assert.equal(seen.size, 12);
});

void test("the permission prompt kinds name the delete, the peer message and the rest", () => {
  const kind = (file: string) => feed(pane(file), 2).at(-1)?.promptKind;
  assert.equal(kind("dangerous-delete.txt"), "dangerous_delete");
  assert.equal(kind("peer-message.txt"), "peer_message");
  assert.equal(kind("permission-prompt.txt"), "other");
});

void test("HANDOFF_READY with the engine not at handoff-pending is not handoff_ready", () => {
  for (const engineSessionId of [
    "3f0c2a7e-5d1b-4c3e-9a2f-1b2c3d4e5f60",
    null,
  ]) {
    const states = feed(pane("handoff-ready.txt"), 3, { engineSessionId }).map(
      (d) => d.state,
    );
    assert.ok(!states.includes("handoff_ready"), String(engineSessionId));
  }
});

void test("HANDOFF_READY inside a user prompt block is not handoff_ready", () => {
  const text =
    "❯ Resume the loop. At the usage limit set session_id to handoff-pending, then print\n" +
    "  HANDOFF_READY g18-orch-runtime\n" +
    "❯ \n" +
    "  Opus 5.5 · high  │  ██░░░░░░░░   17%  174k/1.0M\n";
  const states = feed(text, 3, { engineSessionId: "handoff-pending" }).map(
    (d) => d.state,
  );
  assert.ok(!states.includes("handoff_ready"));
});

void test("the ROADMAP COMPLETE promise with progress not complete is not roadmap_complete", () => {
  for (const completion of ["running", "not_started", null] as const) {
    const states = feed(pane("roadmap-complete.txt"), 3, { completion }).map(
      (d) => d.state,
    );
    assert.ok(!states.includes("roadmap_complete"), String(completion));
  }
});

void test("one idle sample is not idle; three equal samples 60 s apart are", () => {
  const states = feed(pane("idle.txt"), 3).map((d) => d.state);
  assert.deepEqual(states, ["working", "working", "idle"]);
});

void test("only a working reading from a busy sign carries the busy flag", () => {
  assert.equal(feed(pane("working.txt"), 1)[0].busy, true);
  assert.equal(feed(pane("idle.txt"), 1)[0].busy, undefined);
});

void test("three equal samples closer than 60 s apart are not idle", () => {
  let memory = initialMemory();
  const states: SupervisorState[] = [];
  for (let i = 0; i < 10; i++) {
    const d = detectState(
      input({ now: i * 10_000, pane: pane("idle.txt"), memory }),
    );
    states.push(d.state);
    memory = d.memory;
  }
  assert.ok(!states.includes("idle"));
});

void test("a changed pane between samples restarts the idle count", () => {
  let memory = initialMemory();
  const idle = pane("idle.txt");
  const panes = [
    idle,
    idle,
    idle.replace("✻ Crunched", "⏺ one more line\n✻ Crunched"),
    idle,
    idle,
  ];
  const states = panes.map((text, i) => {
    const d = detectState(input({ now: i * MINUTE, pane: text, memory }));
    memory = d.memory;
    return d.state;
  });
  assert.ok(!states.includes("idle"));
});

void test("transcript growth keeps an idle looking pane at working", () => {
  const ds = feed(pane("idle.txt"), 5, {}, (i) => 1000 + i * 10);
  assert.deepEqual(
    ds.map((d) => d.state),
    ["working", "working", "working", "working", "working"],
  );
  assert.match(ds[4].evidence, /transcript: grew/);
});

void test("15 minutes of no transcript growth while working gives stale", () => {
  const ds = feed(pane("working.txt"), 16, {}, () => 4096);
  assert.equal(ds[14].state, "working");
  assert.equal(ds[15].state, "stale");
});

void test("growth inside the 15 minutes restarts the stale clock", () => {
  const ds = feed(pane("working.txt"), 20, {}, (i) => (i < 10 ? 4096 : 5000));
  assert.ok(ds.every((d) => d.state === "working"));
});

void test("an idle session whose last assistant message asks a question needs input", () => {
  const ds = feed(pane("idle.txt"), 3, {
    transcript: { size: 10, lastAssistantText: "Which branch should I use?" },
  });
  assert.equal(last(ds), "needs_input");
});

void test("a dialog seen in one capture is not a dialog state", () => {
  for (const file of [
    "permission-prompt.txt",
    "dangerous-delete.txt",
    "peer-message.txt",
    "limit-menu.txt",
    "auto-continue.txt",
  ]) {
    const [first] = feed(pane(file), 1);
    assert.ok(
      !["permission_prompt", "usage_limit_dialog", "usage_limit_wait"].includes(
        first.state,
      ),
      file,
    );
  }
});

void test("two captures that disagree on the cursor row are not a dialog state", () => {
  const a = pane("limit-menu.txt");
  const b = a
    .replace("❯ 1. Stop", "  1. Stop")
    .replace("    2. Wait", "  ❯ 2. Wait");
  const first = detectState(input({ pane: a }));
  const second = detectState(
    input({ now: 2000, pane: b, memory: first.memory }),
  );
  assert.notEqual(second.state, "usage_limit_dialog");
});

void test("a permission dialog quoted above the input line is not a dialog", () => {
  const text = `${pane("permission-prompt.txt")}\n✻ Crunched for 2s\n❯ \n  Opus 5.5 · high  │  ██░░░░░░░░   17%`;
  const states = feed(text, 3).map((d) => d.state);
  assert.ok(!states.includes("permission_prompt"));
});

void test("an API error under a running spinner is working, not api_error", () => {
  const text = `${pane("api-error.txt")}\n✽ Boondoggling… (3s · ↓ 1k tokens)`;
  assert.equal(last(feed(text, 1)), "working");
});

void test("a limit reset line after an answered limit dialog is usage_limit_wait", () => {
  const after =
    "⏺ You've hit your limit · resets 8:30am (Asia/Calcutta)\n❯ \n  Opus 5.5 · high  │  ██░░░░░░░░   17%";
  const answered = {
    ...initialMemory(),
    state: "usage_limit_dialog" as const,
  };
  assert.equal(last(feed(after, 1, { memory: answered })), "usage_limit_wait");
  assert.notEqual(last(feed(after, 1)), "usage_limit_wait");
});

void test("a dangerous delete dialog over a continuing automatically line is a permission prompt, not a limit wait", () => {
  const text = `    Continuing automatically at 12:40am · esc to cancel\n${pane("dangerous-delete.txt")}`;
  const [, second] = feed(text, 2);
  assert.equal(second.state, "permission_prompt");
  assert.equal(second.promptKind, "dangerous_delete");
});

void test("evidence is one short line", () => {
  for (const [file, count, over] of FIXTURE_STATES) {
    const { evidence } = feed(pane(file), count, over).at(-1)!;
    assert.ok(!evidence.includes("\n"), file);
    assert.ok(evidence.length <= 180, file);
  }
});

void test("a glyph line inside a user prompt does not end the prompt block", () => {
  const text =
    "❯ Resume the loop and when done print the marker line below\n" +
    "  · keep the exact spelling\n" +
    "  HANDOFF_READY g18-orch-runtime\n" +
    "  <promise>ROADMAP COMPLETE g18-orch-runtime</promise>\n" +
    "⏺ Understood.\n" +
    "❯ \n";
  const states = feed(text, 3, {
    engineSessionId: "handoff-pending",
    completion: "complete",
  }).map((d) => d.state);
  assert.ok(!states.includes("handoff_ready"));
  assert.ok(!states.includes("roadmap_complete"));
});

void test("an agent menu titled like the limit menu is a choice menu, not a limit dialog", () => {
  for (const [first, stop] of [
    ["Keep going with the refactor", "Stop"],
    ["Keep going with the refactor", "Stop and wait for the review"],
    ["Continue automatically with the next step", "Stop"],
  ]) {
    const text =
      "⏺ Pick one.\n" +
      "  What do you want to do?\n" +
      `  ❯ 1. ${first}\n` +
      `    2. ${stop}\n` +
      "  Enter to confirm · Esc to cancel\n";
    const ds = feed(text, 2);
    assert.equal(last(ds), "needs_input", stop);
  }
});

void test("a busy sign quoted in a finished tool result does not keep the session working", () => {
  const text =
    "⏺ Bash(node --test watcher.test.ts)\n" +
    "  ⎿  ok 12 - a pane with esc to interrupt is working\n" +
    "     ok 13 - Running… shows while a tool runs\n" +
    "✻ Crunched for 4s\n" +
    "❯ \n" +
    "  Opus 5.5 · high  │  ██░░░░░░░░   17%\n";
  assert.equal(last(feed(text, 3)), "idle");
  assert.equal(last(feed(text, 16, {}, () => 4096)), "idle");
});

void test("a NEEDS_INPUT marker quoted inside a sentence is not the marker", () => {
  const text =
    "⏺ Rule noted: when blocked I end with DISPATCH_STATUS: NEEDS_INPUT and a reason. Nothing blocks me now.\n" +
    "❯ \n";
  assert.notEqual(feed(text, 1)[0].state, "needs_input");
});

void test("a stored idle state is held after a restart while the pane stays the same", () => {
  const idle = pane("idle.txt");
  const ds = feed(idle, 4, { memory: initialMemory("idle") });
  assert.deepEqual(
    ds.map((d) => d.state),
    ["idle", "idle", "idle", "idle"],
  );
});

void test("a restored idle hold ends at the first pane change", () => {
  const first = detectState(
    input({ pane: pane("idle.txt"), memory: initialMemory("idle") }),
  );
  assert.equal(first.state, "idle");
  const changed = detectState(
    input({
      now: 2_000,
      pane: pane("idle.txt").replace("\n❯", "\n⏺ A new answer line.\n❯"),
      memory: first.memory,
    }),
  );
  assert.equal(changed.state, "working");
  assert.equal(changed.memory.restored, false);
});

void test("a restored hold never covers a busy pane or a fresh memory", () => {
  assert.equal(
    detectState(
      input({ pane: pane("working.txt"), memory: initialMemory("idle") }),
    ).state,
    "working",
  );
  assert.equal(
    detectState(input({ pane: pane("idle.txt"), memory: initialMemory() }))
      .state,
    "working",
  );
});

const DIALOG_FIXTURES = [
  "dangerous-delete.txt",
  "permission-prompt.txt",
  "peer-message.txt",
  "limit-menu.txt",
  "limit-menu-2.txt",
  "auto-continue.txt",
];

const READY_FIXTURES: [string, boolean][] = [
  ...DIALOG_FIXTURES.map((file): [string, boolean] => [file, false]),
  ["warming-up.txt", false],
  ["warming-up-2.txt", false],
  ["idle.txt", true],
  ["working.txt", true],
  ["api-error.txt", true],
  ["handoff-ready.txt", true],
  ["auto-continue-2.txt", true],
];

for (const [file, ready] of READY_FIXTURES) {
  void test(`paneReady is ${ready} for recorded pane ${file}`, () => {
    assert.equal(paneReady(pane(file)), ready);
  });
}

for (const file of DIALOG_FIXTURES) {
  void test(`paneReady is false for ${file} below a user prompt`, () => {
    assert.equal(paneReady(`❯ earlier prompt\n${pane(file)}`), false);
  });
}

const RULE = "─".repeat(80);
const boxed = (row: string) =>
  [
    "❯ run the tests",
    "⏺ All 12 tests pass.",
    "✻ Worked for 6s · done 4:01 AM",
    RULE,
    row,
    RULE,
    "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents",
  ].join("\n");

void test("paneReady is false when the input box row is left in bash, memory or background mode", () => {
  assert.equal(paneReady(boxed("❯ ")), true);
  for (const row of ["! ls", "!", "# remember this", "& npm run dev"]) {
    assert.equal(paneReady(boxed(row)), false, row);
  }
  assert.equal(paneReady(boxed("  ⎿  Running…")), false);
});

void test("paneReady is false for a recorded pane whose prompt row is replaced by a mode row", () => {
  const idle = pane("idle.txt");
  for (const mode of ["!", "#", "&"]) {
    const left = idle.replace(/^❯.*$/m, `${mode} ls`);
    assert.notEqual(left, idle);
    assert.equal(paneReady(`❯ earlier prompt\n${left}`), false, mode);
  }
});

void test("paneReady with fewer than two rule lines refuses a mode row below the prompt", () => {
  const footer = "  ⏵⏵ bypass permissions on (shift+tab to cycle)";
  for (const mode of ["! ls", "# remember this", "& npm run dev"]) {
    assert.equal(paneReady(["❯ ", mode, footer].join("\n")), false, mode);
    assert.equal(
      paneReady(["❯ run the tests", RULE, mode, footer].join("\n")),
      false,
      `one rule line, ${mode}`,
    );
  }
  assert.equal(paneReady(["❯ ", footer].join("\n")), true);
  assert.equal(paneReady(["❯ run the tests", RULE, footer].join("\n")), true);
});

void test("a background agent wait reads as busy for the handoff quiet check", () => {
  assert.equal(
    paneBusy("✻ Waiting for 2 background agents to finish\n❯ \n"),
    true,
  );
  assert.equal(paneBusy(pane("idle.txt")), false);
});
