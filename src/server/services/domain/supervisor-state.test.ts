import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  detectState,
  initialMemory,
  inputBoxText,
  limitSurfaceOf,
  paneReady,
  type DetectInput,
  type Detection,
  paneBusy,
  paneDialog,
  unsentBoxText,
} from "./supervisor-state.js";
import type { SupervisorState } from "../../../shared/types.js";

const PANES = new URL("../../test-support/fixtures/panes/", import.meta.url);
const MINUTE = 60_000;

function pane(name: string): string {
  return readFileSync(new URL(name, PANES), "utf8");
}

const PANE_FOOTER =
  "✻ Worked for 6s · done 4:01 AM\n❯ \n  Opus 5.5 · high  │  ██░░░░░░░░   17%  174k/1.0M\n";

function promisePane(slug: string, phrase = "RALPH COMPLETE"): string {
  return `⏺ All units are green.\n  <promise>${phrase} ${slug}</promise>\n${PANE_FOOTER}`;
}

function input(over: Partial<DetectInput>): DetectInput {
  return {
    now: 0,
    tmuxAlive: true,
    atShellPrompt: false,
    paused: null,
    pane: "",
    contextPercent: null,
    engineSessionId: "3f0c2a7e-5d1b-4c3e-9a2f-1b2c3d4e5f60",
    completion: "running",
    engineOpen: true,
    slug: null,
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

const FROZEN_OVER = {
  contextPercent: 0,
  transcript: { size: 100, lastAssistantText: null },
};

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
  [
    "roadmap-complete-final.txt",
    1,
    { completion: "complete", slug: "g2-foundation" },
    "roadmap_complete",
  ],
  ["limit-menu.txt", 2, {}, "usage_limit_dialog"],
  ["limit-menu-2.txt", 2, {}, "usage_limit_dialog"],
  ["auto-continue.txt", 2, {}, "usage_limit_wait"],
  ["auto-continue-3.txt", 2, {}, "usage_limit_wait"],
  ["limit-cancelled.txt", 3, {}, "idle"],
  ["api-error.txt", 1, {}, "api_error"],
  ["api-error-2.txt", 1, {}, "api_error"],
  ["frozen-compacted.txt", 2, FROZEN_OVER, "frozen"],
  ["frozen-compacted-2.txt", 2, FROZEN_OVER, "frozen"],
  ["shell-prompt.txt", 1, { atShellPrompt: true }, "shell_prompt"],
  ["idle.txt", 1, { tmuxAlive: false }, "lost"],
];

for (const [file, count, over, state] of FIXTURE_STATES) {
  void test(`recorded pane ${file} gives ${state}`, () => {
    assert.equal(last(feed(pane(file), count, over)), state);
  });
}

void test("the recorded pane with the promise in an older block and a newer reply below it is not roadmap_complete", () => {
  const state = last(
    feed(pane("roadmap-complete.txt"), 1, {
      completion: "complete",
      slug: "g2-foundation",
    }),
  );
  assert.notEqual(state, "roadmap_complete");
});

void test("every one of the 13 states comes from a recorded pane", () => {
  const seen = new Set(FIXTURE_STATES.map(([, , , s]) => s));
  seen.add(last(feed(pane("working.txt"), 16, {}, () => 100)));
  assert.equal(seen.size, 13);
});

const FROZEN_FIXTURES = ["frozen-compacted.txt", "frozen-compacted-2.txt"];

void test("a compacted idle pane with queued input at 0 percent context is frozen on the second sample 60 s later", () => {
  for (const file of FROZEN_FIXTURES) {
    const ds = feed(pane(file), 2, FROZEN_OVER, () => 100);
    assert.notEqual(ds[0].state, "frozen", file);
    assert.equal(ds[1].state, "frozen", file);
    assert.match(ds[1].evidence, /Compacted while idle/, file);
  }
});

void test("one frozen looking sample is not frozen", () => {
  for (const file of FROZEN_FIXTURES)
    assert.notEqual(feed(pane(file), 1, FROZEN_OVER)[0].state, "frozen", file);
});

void test("a compacted idle pane with context above 0 percent is never frozen", () => {
  for (const file of FROZEN_FIXTURES) {
    const states = feed(pane(file), 4, { contextPercent: 5 }).map(
      (d) => d.state,
    );
    assert.ok(!states.includes("frozen"), file);
  }
});

void test("a compacted idle pane with an empty input line is idle, not frozen", () => {
  const text = pane("frozen-compacted-2.txt").replace(
    "❯ Dispatch wake: Agent done for LOCAL-159",
    "❯ ",
  );
  const states = feed(text, 3, FROZEN_OVER).map((d) => d.state);
  assert.deepEqual(states, ["working", "working", "idle"]);
});

void test("queued input at 0 percent context without a compaction line is not frozen", () => {
  for (const file of FROZEN_FIXTURES) {
    const text = pane(file).replace("✻ Compacted while idle", "✻ Crunched 4s");
    assert.notEqual(text, pane(file));
    const states = feed(text, 4, FROZEN_OVER).map((d) => d.state);
    assert.ok(!states.includes("frozen"), file);
  }
});

void test("a growing transcript on a frozen looking pane is working and keeps frozenSince null", () => {
  const ds = feed(
    pane("frozen-compacted.txt"),
    4,
    FROZEN_OVER,
    (i) => 100 + i * 10,
  );
  assert.ok(ds.every((d) => d.state === "working"));
  assert.ok(ds.slice(1).every((d) => d.memory.frozenSince === null));
});

void test("transcript growth after frozen resets to working and clears frozenSince", () => {
  const ds = feed(pane("frozen-compacted.txt"), 3, FROZEN_OVER, (i) =>
    i < 2 ? 100 : 200,
  );
  assert.equal(ds[1].state, "frozen");
  assert.equal(ds[2].state, "working");
  assert.equal(ds[2].memory.frozenSince, null);
});

void test("a paused card on a frozen pane is paused", () => {
  const paused: DetectInput["paused"] = {
    at: "2026-10-21T00:00:00.000Z",
    by: "user",
    sessionId: "session-1",
    pids: [101],
  };
  const ds = feed(pane("frozen-compacted.txt"), 2, { ...FROZEN_OVER, paused });
  assert.equal(last(ds), "paused");
});

void test("a frozen looking pane with no transcript is never frozen", () => {
  for (const file of FROZEN_FIXTURES) {
    const states = feed(pane(file), 4, { contextPercent: 0 }).map(
      (d) => d.state,
    );
    assert.ok(!states.includes("frozen"), file);
  }
});

void test("a frozen looking pane with a running spinner line is working, not frozen", () => {
  const text = pane("frozen-compacted.txt").replace(
    "❯ Dispatch wake: decision answered for LOCAL-161",
    "✻ Thinking… (esc to interrupt)\n\n❯ Dispatch wake: decision answered for LOCAL-161",
  );
  const ds = feed(text, 3, FROZEN_OVER);
  assert.ok(ds.every((d) => d.state === "working"));
  assert.ok(ds.every((d) => d.memory.frozenSince === null));
});

void test("a box text that changes on each sample is never frozen", () => {
  let memory = initialMemory();
  const states: SupervisorState[] = [];
  for (let i = 0; i < 4; i++) {
    const d = detectState(
      input({
        ...FROZEN_OVER,
        now: i * MINUTE,
        pane: pane("frozen-compacted.txt").replace(
          "no action is needed",
          `no action ${i} is needed`,
        ),
        memory,
      }),
    );
    states.push(d.state);
    memory = d.memory;
  }
  assert.ok(!states.includes("frozen"));
});

void test("a stored frozen state is kept on the first sample while the frozen pane is unchanged", () => {
  const [first] = feed(pane("frozen-compacted.txt"), 1, {
    ...FROZEN_OVER,
    memory: initialMemory("frozen"),
  });
  assert.equal(first.state, "frozen");
  assert.equal(first.memory.frozenSince, 0);
});

void test("a stored frozen state is released when the pane no longer shows the freeze", () => {
  const text = pane("frozen-compacted-2.txt").replace(
    "❯ Dispatch wake: Agent done for LOCAL-159",
    "❯ ",
  );
  const [first] = feed(text, 1, {
    ...FROZEN_OVER,
    memory: initialMemory("frozen"),
  });
  assert.equal(first.state, "working");
});

void test("inputBoxText joins the queued box text and is empty for an idle prompt", () => {
  assert.equal(
    inputBoxText(pane("frozen-compacted.txt")),
    "Dispatch wake: decision answered for LOCAL-161 Dispatch wake: decision answered for LOCAL-161 Orchestrator: the wake lines above are already satisfied Orchestrator: no action is needed until the next event",
  );
  assert.equal(inputBoxText(pane("idle.txt")), "");
});

void test("unsentBoxText is null for an empty box and for a box text the transcript shows", () => {
  const box = inputBoxText(pane("frozen-compacted.txt"));
  assert.equal(unsentBoxText(pane("idle.txt"), ["hello"]), null);
  assert.equal(unsentBoxText(pane("frozen-compacted.txt"), []), box);
  assert.equal(
    unsentBoxText(pane("frozen-compacted.txt"), [box.replace(/ /g, "\n")]),
    null,
  );
});

void test("the shortly notice is the usage limit wait evidence", () => {
  const wait = feed(pane("auto-continue-3.txt"), 2).at(-1);
  assert.match(String(wait?.evidence), /Continuing shortly · esc to cancel/);
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
    const states = feed(promisePane("g2", "ROADMAP COMPLETE"), 3, {
      completion,
      slug: "g2",
    }).map((d) => d.state);
    assert.ok(!states.includes("roadmap_complete"), String(completion));
  }
});

void test("the RALPH COMPLETE promise of a single PRD loop is roadmap_complete only with completion complete", () => {
  const text = promisePane("demo-feature");
  const slug = "demo-feature";
  const done = feed(text, 3, { completion: "complete", slug }).map(
    (d) => d.state,
  );
  assert.ok(done.includes("roadmap_complete"));
  const running = feed(text, 3, { completion: "running", slug }).map(
    (d) => d.state,
  );
  assert.ok(!running.includes("roadmap_complete"));
});

void test("a completion signal in the pane or the transcript tail gives roadmap_complete only with completion complete", () => {
  const promiseText = promisePane("demo");
  const jobPane = pane("after-pause-job-lines.txt");
  const tail = (text: string) => ({
    size: 100,
    lastAssistantText: text,
    userTexts: [],
  });
  const sources: [string, string, DetectInput["transcript"], string | null][] =
    [
      ["pane promise", promiseText, null, "pane:"],
      [
        "transcript promise",
        jobPane,
        tail("All green.\n<promise>RALPH COMPLETE demo</promise>"),
        "transcript:",
      ],
      [
        "transcript DONE line",
        jobPane,
        tail("Built.\nDISPATCH_STATUS: DONE - demo built"),
        "transcript:",
      ],
      ["none", jobPane, tail("Still working on phase 2."), null],
    ];
  for (const [name, text, transcript, prefix] of sources) {
    for (const completion of ["complete", "running"] as const) {
      const d = detectState(
        input({ pane: text, transcript, completion, slug: "demo" }),
      );
      const wanted = prefix !== null && completion === "complete";
      assert.equal(
        d.state === "roadmap_complete",
        wanted,
        `${name} ${completion}`,
      );
      if (wanted) assert.ok(d.evidence.startsWith(prefix), d.evidence);
    }
  }
});

void test("with the engine closed a transcript tail signal is not roadmap_complete, a pane promise still is", () => {
  const jobPane = pane("after-pause-job-lines.txt");
  for (const lastAssistantText of [
    "All green.\n<promise>RALPH COMPLETE demo</promise>",
    "Built.\nDISPATCH_STATUS: DONE - demo built",
  ]) {
    const d = detectState(
      input({
        pane: jobPane,
        completion: "complete",
        engineOpen: false,
        slug: "demo",
        transcript: { size: 100, lastAssistantText },
      }),
    );
    assert.notEqual(d.state, "roadmap_complete", lastAssistantText);
  }
  const closed = detectState(
    input({
      pane: promisePane("demo"),
      completion: "complete",
      engineOpen: false,
      slug: "demo",
    }),
  );
  assert.equal(closed.state, "roadmap_complete");
  assert.ok(closed.evidence.startsWith("pane:"), closed.evidence);
});

void test("a DISPATCH_STATUS DONE line typed inside a pane user prompt block is not a completion signal", () => {
  const text =
    "❯ Finish up. When all phases are green print\n" +
    "  DISPATCH_STATUS: DONE - demo built\n" +
    "❯ \n" +
    "  Opus 5.5 · high  │  ██░░░░░░░░   17%  174k/1.0M\n";
  const states = feed(text, 3, { completion: "complete" }).map((d) => d.state);
  assert.ok(!states.includes("roadmap_complete"));
});

void test("a DONE line counts only in the marker parser's shape", () => {
  const jobPane = pane("after-pause-job-lines.txt");
  const stateOf = (text: string) =>
    detectState(
      input({
        pane: jobPane,
        completion: "complete",
        transcript: { size: 100, lastAssistantText: text },
      }),
    ).state;
  assert.equal(stateOf("DISPATCH_STATUS: DONE - built"), "roadmap_complete");
  assert.equal(stateOf("DISPATCH_STATUS: DONE"), "roadmap_complete");
  assert.notEqual(stateOf("DISPATCH_STATUS: DONE."), "roadmap_complete");
});

void test("a pane DONE line counts only in the newest agent block", () => {
  const head = "⏺ Phase 2 is green.\n  DISPATCH_STATUS: DONE - demo built\n";
  const newer = "⏺ Which branch should I rebase on?\n";
  const footer = "❯ \n  Opus 5.5 · high  │  ██░░░░░░░░   17%  174k/1.0M\n";
  const newest = detectState(
    input({ pane: head + footer, completion: "complete" }),
  );
  assert.equal(newest.state, "roadmap_complete");
  assert.ok(newest.evidence.startsWith("pane:"), newest.evidence);
  const states = feed(head + newer + footer, 3, {
    completion: "complete",
  }).map((d) => d.state);
  assert.ok(!states.includes("roadmap_complete"));
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

void test("a paused input gives paused and resets the growth clock to now", () => {
  const memory = { ...initialMemory("working"), lastGrowthAt: 0 };
  const d = detectState(
    input({
      now: 10 * MINUTE,
      pane: pane("working.txt"),
      paused: {
        at: "2026-10-13T00:00:00.000Z",
        by: "user",
        sessionId: "session-1",
        pids: [101],
      },
      memory,
    }),
  );
  assert.equal(d.state, "paused");
  assert.equal(d.evidence, "paused by user");
  assert.equal(d.memory.lastGrowthAt, 10 * MINUTE);
  assert.deepEqual(d.memory.idleSamples, []);
});

void test("a paused input wins over the shell prompt check", () => {
  const d = detectState(
    input({
      atShellPrompt: true,
      paused: {
        at: "2026-10-13T00:00:00.000Z",
        by: "memory",
        sessionId: "session-1",
        pids: [101],
      },
    }),
  );
  assert.equal(d.state, "paused");
  assert.equal(d.evidence, "paused by memory");
});

void test("a dead tmux session is lost even when the card is marked paused", () => {
  const d = detectState(
    input({
      tmuxAlive: false,
      paused: {
        at: "2026-10-13T00:00:00.000Z",
        by: "user",
        sessionId: "session-1",
        pids: [101],
      },
    }),
  );
  assert.equal(d.state, "lost");
});

void test("the first sample after a pause is not stale", () => {
  const paused = detectState(
    input({
      now: 30 * MINUTE,
      pane: pane("working.txt"),
      paused: {
        at: "2026-10-13T00:00:00.000Z",
        by: "user",
        sessionId: "session-1",
        pids: [101],
      },
      transcript: { size: 4096, lastAssistantText: null },
      memory: { ...initialMemory("working"), lastGrowthAt: 0 },
    }),
  );
  const after = detectState(
    input({
      now: 30 * MINUTE + 1000,
      pane: pane("working.txt"),
      transcript: { size: 4096, lastAssistantText: null },
      memory: paused.memory,
    }),
  );
  assert.equal(after.state, "working");
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

void test("a NEEDS_INPUT marker after the assistant bullet is the marker", () => {
  const text = "⏺ DISPATCH_STATUS: NEEDS_INPUT - which size\n❯ \n";
  assert.equal(feed(text, 1)[0].state, "needs_input");
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
  ["limit-cancelled.txt", true],
];

for (const [file, ready] of READY_FIXTURES) {
  void test(`paneReady is ${ready} for recorded pane ${file}`, () => {
    assert.equal(paneReady(pane(file)), ready);
  });
}

void test("limitSurfaceOf is null for the cancelled post-menu screen", () => {
  assert.equal(limitSurfaceOf(pane("limit-cancelled.txt")), null);
});

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

const PERMISSION_DIALOG =
  "Do you want to proceed?\n ❯ 1. Yes\n   2. No\n Esc to cancel";

void test("paneDialog sees a dialog below the input line", () => {
  assert.equal(paneDialog(`output\n────\n❯ \n${PERMISSION_DIALOG}`), true);
});

void test("paneDialog sees a dialog in a pane with no input line", () => {
  assert.equal(paneDialog(PERMISSION_DIALOG), true);
});

void test("paneDialog is false for a plain idle pane", () => {
  assert.equal(paneDialog("output\n────\n❯ \n────\n  ? for shortcuts"), false);
});

const LIMIT_TAIL =
  "You've hit your weekly limit · resets Oct 20 at 8:30am (Asia/Calcutta)";

function tailStates(
  text: string,
  lastAssistantText: string | null,
  sizes: number[] = [100, 100, 100],
): Detection[] {
  const out: Detection[] = [];
  let memory = initialMemory();
  sizes.forEach((size, i) => {
    const d = detectState(
      input({
        now: i * MINUTE,
        pane: text,
        memory,
        transcript: { size, lastAssistantText },
      }),
    );
    out.push(d);
    memory = d.memory;
  });
  return out;
}

void test("a usage limit message at the transcript tail gives usage_limit_wait on the second agreeing sample", () => {
  const states = tailStates(pane("after-pause-job-lines.txt"), LIMIT_TAIL);
  assert.notEqual(states[0].state, "usage_limit_wait");
  assert.equal(states[1].state, "usage_limit_wait");
  assert.equal(states[2].state, "usage_limit_wait");
  assert.equal(states[1].evidence, `transcript: ${LIMIT_TAIL}`);
});

void test("a usage limit message is read in a quiet pane, with a curly apostrophe and after a first line", () => {
  for (const text of [
    LIMIT_TAIL.replaceAll("'", "\u2019"),
    `${LIMIT_TAIL}\nsecond line`,
    "You've hit your session limit",
    "You've hit your limit · resets 8:30am (Asia/Calcutta)",
    "You've hit your Opus weekly limit · resets Oct 20 at 8:30am",
  ]) {
    const states = tailStates(pane("idle.txt"), text, [100, 100]);
    assert.equal(states[1].state, "usage_limit_wait", text);
  }
});

void test("the weekly footer warning at the transcript tail never gives usage_limit_wait", () => {
  for (const text of [
    "You've used 90% of your weekly limit",
    "You\u2019ve used 90% of your weekly limit · resets Oct 20 at 8:30am",
    "I hit the weekly limit of the API earlier",
  ]) {
    const states = tailStates(
      pane("after-pause-job-lines.txt"),
      text,
      [100, 100, 100, 100],
    );
    assert.ok(
      states.every((d) => d.state !== "usage_limit_wait"),
      text,
    );
  }
});

void test("a busy pane with a usage limit message at the transcript tail never gives usage_limit_wait", () => {
  const states = tailStates(pane("working.txt"), LIMIT_TAIL, [100, 100, 100]);
  assert.ok(states.every((d) => d.state !== "usage_limit_wait"));
});

void test("a growing transcript with a usage limit message at the tail never gives usage_limit_wait", () => {
  const states = tailStates(
    pane("after-pause-job-lines.txt"),
    LIMIT_TAIL,
    [100, 200, 300, 400],
  );
  assert.ok(states.every((d) => d.state !== "usage_limit_wait"));
});

void test("a transcript that grows after two agreeing samples leaves usage_limit_wait", () => {
  const states = tailStates(
    pane("after-pause-job-lines.txt"),
    LIMIT_TAIL,
    [100, 100, 100, 200],
  );
  assert.equal(states[2].state, "usage_limit_wait");
  assert.equal(states[3].state, "working");
});

void test("an open limit menu wins over a usage limit message at the transcript tail", () => {
  const states = tailStates(pane("limit-menu.txt"), LIMIT_TAIL, [100, 100]);
  assert.equal(states[1].state, "usage_limit_dialog");
});

void test("a changed limit message restarts the two sample rule", () => {
  let memory = initialMemory();
  const sample = (text: string) => {
    const d = detectState(
      input({
        pane: pane("idle.txt"),
        memory,
        transcript: { size: 100, lastAssistantText: text },
      }),
    );
    memory = d.memory;
    return d.state;
  };
  assert.notEqual(sample(LIMIT_TAIL), "usage_limit_wait");
  assert.notEqual(
    sample("You've hit your session limit · resets 3pm"),
    "usage_limit_wait",
  );
  assert.equal(
    sample("You've hit your session limit · resets 3pm"),
    "usage_limit_wait",
  );
});

void test("a pane promise line counts only for the slug, alone on its line, in the newest agent block", () => {
  const stateOf = (text: string, slug: string) =>
    detectState(input({ pane: text, completion: "complete", slug })).state;
  assert.equal(
    stateOf(promisePane("local-159"), "local-159"),
    "roadmap_complete",
  );
  const quoted =
    "⏺ The doc says the test writes <promise>RALPH COMPLETE local-159</promise> and posts the hook.\n" +
    PANE_FOOTER;
  assert.notEqual(stateOf(quoted, "local-170"), "roadmap_complete");
  assert.notEqual(stateOf(quoted, "local-159"), "roadmap_complete");
  assert.notEqual(
    stateOf(promisePane("local-159"), "local-170"),
    "roadmap_complete",
  );
  assert.notEqual(stateOf(promisePane("local-159"), ""), "roadmap_complete");
  const older =
    "⏺ Done.\n  <promise>RALPH COMPLETE local-159</promise>\n⏺ Which branch should I rebase on?\n" +
    PANE_FOOTER;
  assert.notEqual(stateOf(older, "local-159"), "roadmap_complete");
});

void test("a transcript tail promise counts only on its own line", () => {
  const stateOf = (lastAssistantText: string, slug: string | null) =>
    detectState(
      input({
        pane: pane("after-pause-job-lines.txt"),
        completion: "complete",
        slug,
        transcript: { size: 100, lastAssistantText },
      }),
    ).state;
  const own = "All green.\n<promise>RALPH COMPLETE local-159</promise>";
  const sentence =
    "The test writes <promise>RALPH COMPLETE local-159</promise> and posts the hook.";
  assert.equal(stateOf(own, "local-159"), "roadmap_complete");
  assert.notEqual(stateOf(sentence, "local-159"), "roadmap_complete");
  assert.notEqual(stateOf(own, "local-170"), "roadmap_complete");
  assert.notEqual(stateOf(own, null), "roadmap_complete");
  assert.equal(
    stateOf("Built.\nDISPATCH_STATUS: DONE - built", null),
    "roadmap_complete",
  );
});

void test("roadmap_complete carries doneLine only when a DISPATCH_STATUS DONE line is in the scope", () => {
  const slug = "local-159";
  const detect = (over: Partial<DetectInput>) =>
    detectState(input({ completion: "complete", slug, ...over }));
  const promiseOnly = detect({ pane: promisePane(slug) });
  assert.equal(promiseOnly.state, "roadmap_complete");
  assert.equal(promiseOnly.doneLine, undefined);

  const withDone = detect({
    pane: promisePane(slug).replace(
      PANE_FOOTER,
      `  DISPATCH_STATUS: DONE - built\n${PANE_FOOTER}`,
    ),
  });
  assert.equal(withDone.state, "roadmap_complete");
  assert.equal(withDone.doneLine, true);

  const jobPane = pane("after-pause-job-lines.txt");
  const tailPromise = detect({
    pane: jobPane,
    transcript: {
      size: 100,
      lastAssistantText: `All green.\n<promise>RALPH COMPLETE ${slug}</promise>`,
    },
  });
  assert.equal(tailPromise.state, "roadmap_complete");
  assert.equal(tailPromise.doneLine, undefined);
  const tailDone = detect({
    pane: jobPane,
    transcript: {
      size: 100,
      lastAssistantText: "Built.\nDISPATCH_STATUS: DONE - built",
    },
  });
  assert.equal(tailDone.state, "roadmap_complete");
  assert.equal(tailDone.doneLine, true);
});

void test("doneLine stays unset for a DONE line in an older agent block or in the tail of a closed engine", () => {
  const slug = "local-159";
  const detect = (over: Partial<DetectInput>) =>
    detectState(input({ completion: "complete", slug, ...over }));
  const olderDone = detect({
    pane: `⏺ Built.\n  DISPATCH_STATUS: DONE - built\n${promisePane(slug)}`,
  });
  assert.equal(olderDone.state, "roadmap_complete");
  assert.equal(olderDone.doneLine, undefined);

  const closedTail = detect({
    engineOpen: false,
    pane: promisePane(slug),
    transcript: {
      size: 100,
      lastAssistantText: "Built.\nDISPATCH_STATUS: DONE - built",
    },
  });
  assert.equal(closedTail.state, "roadmap_complete");
  assert.equal(closedTail.doneLine, undefined);
});

void test("doneLine is read from a pane without the agent block glyph", () => {
  const slug = "local-159";
  const detect = (text: string) =>
    detectState(input({ completion: "complete", slug, pane: text }));
  const bare = `  <promise>RALPH COMPLETE ${slug}</promise>\n`;
  const promiseOnly = detect(bare + PANE_FOOTER);
  assert.equal(promiseOnly.state, "roadmap_complete");
  assert.equal(promiseOnly.doneLine, undefined);

  const withDone = detect(
    `${bare}  DISPATCH_STATUS: DONE - built\n${PANE_FOOTER}`,
  );
  assert.equal(withDone.state, "roadmap_complete");
  assert.equal(withDone.doneLine, true);
});

void test("a DONE line typed at the prompt never sets doneLine", () => {
  const slug = "local-159";
  const detect = (text: string) =>
    detectState(input({ completion: "complete", slug, pane: text }));
  const head = `⏺ All units are green.\n  <promise>RALPH COMPLETE ${slug}</promise>\n`;
  const modelRow = "  Opus 5.5 · high  │  ██░░░░░░░░   17%  174k/1.0M\n";

  const inInputBox = detect(
    `${head}❯ DISPATCH_STATUS: DONE - built\n${modelRow}`,
  );
  assert.equal(inInputBox.state, "roadmap_complete");
  assert.equal(inInputBox.doneLine, undefined);

  const inUserBlock = detect(
    `${head}❯ DISPATCH_STATUS: DONE - built\n❯ \n${modelRow}`,
  );
  assert.equal(inUserBlock.state, "roadmap_complete");
  assert.equal(inUserBlock.doneLine, undefined);
});

void test("doneLine is set when the promise is in the pane and the DONE line only in the transcript tail", () => {
  const slug = "local-159";
  const detect = (over: Partial<DetectInput>) =>
    detectState(
      input({ completion: "complete", slug, pane: promisePane(slug), ...over }),
    );
  const split = detect({
    transcript: {
      size: 100,
      lastAssistantText: "Built.\nDISPATCH_STATUS: DONE - built",
    },
  });
  assert.equal(split.state, "roadmap_complete");
  assert.ok(split.evidence.startsWith("pane:"), split.evidence);
  assert.equal(split.doneLine, true);

  const closedEngine = detect({
    engineOpen: false,
    transcript: {
      size: 100,
      lastAssistantText: "Built.\nDISPATCH_STATUS: DONE - built",
    },
  });
  assert.equal(closedEngine.doneLine, undefined);
});

void test("a pane DONE line with no promise gives roadmap_complete with doneLine", () => {
  const slug = "local-159";
  const detected = detectState(
    input({
      completion: "complete",
      slug,
      pane: `⏺ Built.\n  DISPATCH_STATUS: DONE - built\n${PANE_FOOTER}`,
    }),
  );
  assert.equal(detected.state, "roadmap_complete");
  assert.ok(detected.evidence.startsWith("pane:"), detected.evidence);
  assert.equal(detected.doneLine, true);
});
