import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupervisorState } from "../../../../shared/types.js";
import {
  actionErrorCopy,
  failureCopy,
  loadErrorCopy,
  panelModel,
  refusalReason,
  staleBadgeText,
  startErrorCopy,
  STALE_REASON,
  SUPERVISOR_OFF_REASON,
  STOP_TOOLTIP,
  type OrchestratorView,
  type PanelInput,
} from "./panel-model.js";

function main(
  state: OrchestratorView["state"],
  session: Partial<NonNullable<OrchestratorView["session"]>> | null,
  role: "main" | "extra" = "main",
): OrchestratorView {
  return {
    id: role,
    name: role,
    role,
    scope: { groupIds: [], ticketIds: [] },
    policyOverride: {},
    cardId: session === null ? null : "card-1",
    state,
    createdAt: "2026-10-08T00:00:00.000Z",
    session:
      session === null
        ? null
        : {
            cardId: "card-1",
            state: null,
            stateReason: null,
            contextPercent: null,
            model: null,
            hasTmuxSession: true,
            activeSessionId: "s1",
            ttydPort: 7000,
            stateSince: null,
            startError: null,
            ...session,
          },
  };
}

function input(patch: Partial<PanelInput>): PanelInput {
  return {
    orchestrators: [],
    supervisor: "on",
    stale: false,
    pending: null,
    decisionCount: 0,
    ...patch,
  };
}

test("a board with no orchestrator shows an enabled Start and the empty terminal", () => {
  const model = panelModel(input({}));
  assert.equal(model.main, null);
  assert.equal(model.terminal, "empty");
  assert.deepEqual(model.control, {
    kind: "start",
    label: "Start orchestrator",
    disabled: false,
    tooltip: null,
    reason: null,
  });
});

test("Start is disabled with the supervisor reason when the supervisor is off", () => {
  const control = panelModel(input({ supervisor: "off" })).control;
  assert.equal(control?.kind, "start");
  assert.equal(control?.disabled, true);
  assert.equal(control?.reason, SUPERVISOR_OFF_REASON);
});

test("a stopped record with no session shows Start and a not-running terminal", () => {
  const model = panelModel(input({ orchestrators: [main("stopped", null)] }));
  assert.equal(model.control?.kind, "start");
  assert.equal(model.terminal, "not-running");
});

const RESUME_CASES = ["lost", "shell_prompt"] as const;
for (const state of RESUME_CASES) {
  test(`${state} shows only Resume`, () => {
    for (const record of ["running", "stopped"] as const) {
      const control = panelModel(
        input({ orchestrators: [main(record, { state })] }),
      ).control;
      assert.equal(control?.kind, "resume");
      assert.equal(control?.label, "Resume orchestrator");
      assert.equal(control?.disabled, false);
    }
  });
}

const STOP_TABLE: [SupervisorState | null, boolean][] = [
  ["working", false],
  ["idle", false],
  ["needs_input", false],
  ["handoff_ready", false],
  ["roadmap_complete", false],
  ["api_error", false],
  ["stale", false],
  [null, false],
  ["permission_prompt", true],
  ["usage_limit_dialog", true],
  ["usage_limit_wait", true],
];
for (const [state, disabled] of STOP_TABLE) {
  test(`a running session at ${String(state)} has Stop ${disabled ? "disabled" : "enabled"}`, () => {
    const control = panelModel(
      input({ orchestrators: [main("running", { state })] }),
    ).control;
    assert.equal(control?.kind, "stop");
    assert.equal(control?.disabled, disabled);
    assert.equal(control?.tooltip, STOP_TOOLTIP);
  });
}

test("a running record with no session state yet still shows the Starting badge", () => {
  const model = panelModel(
    input({ orchestrators: [main("running", { state: null })] }),
  );
  assert.equal(model.stateKey, null);
  assert.equal(model.transition, "Starting");
  assert.equal(model.control?.kind, "stop");
  const working = panelModel(
    input({ orchestrators: [main("running", { state: "working" })] }),
  );
  assert.equal(working.transition, null);
});

test("starting and stopping records show no control and a transition label", () => {
  const starting = panelModel(
    input({ orchestrators: [main("starting", { hasTmuxSession: false })] }),
  );
  assert.equal(starting.control, null);
  assert.equal(starting.transition, "Starting");
  const stopping = panelModel(
    input({ orchestrators: [main("stopping", { state: "idle" })] }),
  );
  assert.equal(stopping.control, null);
  assert.equal(stopping.transition, "Stopping");
});

test("a stale stream disables every control with the reconnect reason", () => {
  const records: [OrchestratorView[], string][] = [
    [[], "start"],
    [[main("running", { state: "working" })], "stop"],
    [[main("stopped", { state: "lost" })], "resume"],
  ];
  for (const [orchestrators, kind] of records) {
    const control = panelModel(input({ orchestrators, stale: true })).control;
    assert.equal(control?.kind, kind);
    assert.equal(control?.disabled, true);
    assert.equal(control?.reason, STALE_REASON);
  }
});

test("an action in flight disables the control", () => {
  const control = panelModel(input({ pending: "start" })).control;
  assert.equal(control?.disabled, true);
  assert.equal(control?.reason, null);
});

test("the terminal is live once the session has a ttyd port and an id", () => {
  const live = panelModel(
    input({ orchestrators: [main("running", { state: "working" })] }),
  );
  assert.equal(live.terminal, "live");
  assert.equal(live.terminalSrc, "/sessions/s1/terminal/");
  const waiting = panelModel(
    input({
      orchestrators: [main("running", { state: "working", ttydPort: null })],
    }),
  );
  assert.equal(waiting.terminal, "connecting");
  assert.equal(waiting.terminalSrc, null);
});

test("an extra orchestrator alone does not count as the main one", () => {
  const model = panelModel(
    input({ orchestrators: [main("running", { state: "working" }, "extra")] }),
  );
  assert.equal(model.main, null);
  assert.equal(model.control?.kind, "start");
});

test("tab labels carry the counts", () => {
  const model = panelModel(
    input({
      decisionCount: 3,
      orchestrators: [main("stopped", null), main("stopped", null, "extra")],
    }),
  );
  assert.deepEqual(model.tabs, {
    terminal: "Terminal",
    decisions: "Decisions (3)",
    policy: "Policy",
    orchestrators: "Orchestrators (2)",
  });
  assert.equal(panelModel(input({})).tabs.orchestrators, "Orchestrators (0)");
});

test("refusal codes map to reason text and unknown ones pass through", () => {
  assert.equal(
    refusalReason("policy-refused", "supervisor-off"),
    "the supervisor is off",
  );
  assert.equal(
    refusalReason("orchestrator-running", null),
    "it is already running",
  );
  assert.equal(
    refusalReason(
      "orchestrator-session-live",
      "the session is still open: resume it",
    ),
    "the session is still open, resume it",
  );
  assert.equal(
    refusalReason("orchestrator-not-resumable", null),
    "there is nothing to resume",
  );
  assert.equal(
    refusalReason("invalid-budgetPerGroup", null),
    "the budget has to be an amount above 0 and at most 100000",
  );
  assert.equal(
    refusalReason("hard-below-handoff", null),
    "hard handoff has to be a number above the handoff percent, up to 100",
  );
  assert.equal(refusalReason("weird", "because"), "because");
  assert.equal(refusalReason("weird", null), "the request failed (weird)");
  assert.equal(refusalReason(null, null), "the request failed");
  assert.equal(refusalReason("policy-refused", "other"), "other");
});

test("error copy follows the contract strings", () => {
  assert.equal(
    startErrorCopy("the supervisor is off"),
    "The orchestrator did not start: the supervisor is off.",
  );
  assert.equal(actionErrorCopy("Stop", "boom."), "Stop failed: boom.");
  assert.equal(
    loadErrorCopy("getOrchestrators failed: 500"),
    "The orchestrator panel did not load: getOrchestrators failed: 500.",
  );
  assert.equal(failureCopy("start", "x"), "The orchestrator did not start: x.");
  assert.equal(failureCopy("stop", "x"), "Stop failed: x.");
  assert.equal(failureCopy("resume", "x"), "Resume failed: x.");
  assert.equal(staleBadgeText("10:42"), "State from 10:42");
});

test("a stopped record whose start failed in the background shows the error copy and Start", () => {
  const model = panelModel(
    input({
      orchestrators: [
        main("stopped", {
          startError: "the launch failed.",
          hasTmuxSession: false,
        }),
      ],
    }),
  );
  assert.equal(
    model.startFailure,
    "The orchestrator did not start: the launch failed.",
  );
  assert.equal(model.control?.kind, "start");
  assert.equal(
    panelModel(
      input({ orchestrators: [main("stopped", { startError: null })] }),
    ).startFailure,
    null,
  );
  assert.equal(
    panelModel(input({ orchestrators: [main("running", { startError: "x" })] }))
      .startFailure,
    null,
  );
});

test("an orchestrator list that never loaded offers no control and no count", () => {
  const model = panelModel(input({ loaded: false }));
  assert.equal(model.control, null);
  assert.equal(model.terminal, "unavailable");
  assert.equal(model.tabs.orchestrators, "Orchestrators");
});

test("a running record whose session is lost asks for a resume in the terminal", () => {
  const model = panelModel(
    input({
      orchestrators: [
        main("running", {
          state: "lost",
          hasTmuxSession: false,
          ttydPort: null,
        }),
      ],
    }),
  );
  assert.equal(model.terminal, "resume");
  assert.equal(model.control?.kind, "resume");
});
