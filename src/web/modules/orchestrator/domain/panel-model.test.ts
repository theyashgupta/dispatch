import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupervisorState } from "../../../../shared/types.js";
import {
  actionErrorCopy,
  controlFor,
  failureCopy,
  refusalReason,
  startErrorCopy,
  STALE_REASON,
  terminalFor,
  terminalSrcFor,
  SUPERVISOR_OFF_REASON,
  STOP_TOOLTIP,
  type OrchestratorView,
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
            cost: null,
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

const ON = { supervisor: "on", stale: false, pending: null } as const;

function controlOf(
  orchestrators: readonly OrchestratorView[],
  patch: Partial<Parameters<typeof controlFor>[1]> = {},
) {
  const record = orchestrators.find((o) => o.role === "main") ?? null;
  return controlFor(record, { ...ON, ...patch });
}

function terminalOf(orchestrators: readonly OrchestratorView[]) {
  return terminalFor(orchestrators.find((o) => o.role === "main") ?? null);
}

test("a board with no orchestrator shows an enabled Start and the empty terminal", () => {
  assert.equal(terminalOf([]), "empty");
  assert.deepEqual(controlOf([]), {
    kind: "start",
    label: "Start orchestrator",
    disabled: false,
    tooltip: null,
    reason: null,
  });
});

test("Start is disabled with the supervisor reason when the supervisor is off", () => {
  const control = controlOf([], { supervisor: "off" });
  assert.equal(control?.kind, "start");
  assert.equal(control?.disabled, true);
  assert.equal(control?.reason, SUPERVISOR_OFF_REASON);
});

test("a stopped record with no session shows Start and a not-running terminal", () => {
  const records = [main("stopped", null)];
  assert.equal(controlOf(records)?.kind, "start");
  assert.equal(terminalOf(records), "not-running");
});

const RESUME_CASES = ["lost", "shell_prompt"] as const;
for (const state of RESUME_CASES) {
  test(`${state} shows only Resume`, () => {
    for (const record of ["running", "stopped"] as const) {
      const control = controlOf([main(record, { state })]);
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
    const control = controlOf([main("running", { state })]);
    assert.equal(control?.kind, "stop");
    assert.equal(control?.disabled, disabled);
    assert.equal(control?.tooltip, STOP_TOOLTIP);
  });
}

test("starting and stopping records show no control", () => {
  assert.equal(controlOf([main("starting", { hasTmuxSession: false })]), null);
  assert.equal(controlOf([main("stopping", { state: "idle" })]), null);
});

test("a stale stream disables every control with the reconnect reason", () => {
  const records: [OrchestratorView[], string][] = [
    [[], "start"],
    [[main("running", { state: "working" })], "stop"],
    [[main("stopped", { state: "lost" })], "resume"],
  ];
  for (const [orchestrators, kind] of records) {
    const control = controlOf(orchestrators, { stale: true });
    assert.equal(control?.kind, kind);
    assert.equal(control?.disabled, true);
    assert.equal(control?.reason, STALE_REASON);
  }
});

test("an action in flight disables the control", () => {
  const control = controlOf([], { pending: "start" });
  assert.equal(control?.disabled, true);
  assert.equal(control?.reason, null);
});

test("the terminal is live once the session has a ttyd port and an id", () => {
  const live = main("running", { state: "working" });
  assert.equal(terminalFor(live), "live");
  assert.equal(terminalSrcFor("live", live), "/sessions/s1/terminal/");
  const waiting = main("running", { state: "working", ttydPort: null });
  assert.equal(terminalFor(waiting), "connecting");
  assert.equal(terminalSrcFor("connecting", waiting), null);
});

test("an extra orchestrator alone does not count as the main one", () => {
  const records = [main("running", { state: "working" }, "extra")];
  assert.equal(terminalOf(records), "empty");
  assert.equal(controlOf(records)?.kind, "start");
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
  assert.equal(failureCopy("start", "x"), "The orchestrator did not start: x.");
  assert.equal(failureCopy("stop", "x"), "Stop failed: x.");
  assert.equal(failureCopy("resume", "x"), "Resume failed: x.");
});

test("a running record whose session is lost asks for a resume in the terminal", () => {
  const records = [
    main("running", { state: "lost", hasTmuxSession: false, ttydPort: null }),
  ];
  assert.equal(terminalOf(records), "resume");
  assert.equal(controlOf(records)?.kind, "resume");
});

test("the terminal of an extra record with an open session is live at its own session path", () => {
  const extra = main("running", { activeSessionId: "s9" }, "extra");
  assert.equal(terminalFor(extra), "live");
  assert.equal(terminalSrcFor("live", extra), "/sessions/s9/terminal/");
  assert.equal(terminalSrcFor("connecting", extra), null);
  assert.equal(terminalFor(null), "empty");
});

test("the centre control follows the spec rules for running, stopped, lost, stale and pending", () => {
  const on = { supervisor: "on", stale: false, pending: null } as const;
  const running = main("running", { state: "working" });
  assert.equal(controlFor(running, on)?.kind, "stop");
  assert.equal(controlFor(running, on)?.disabled, false);
  assert.equal(controlFor(main("stopped", null), on)?.kind, "start");
  const lost = main("running", { state: "lost" });
  assert.equal(controlFor(lost, on)?.kind, "resume");
  const stale = controlFor(running, { ...on, stale: true });
  assert.equal(stale?.disabled, true);
  assert.equal(stale?.reason, STALE_REASON);
  assert.equal(controlFor(running, { ...on, pending: "stop" })?.disabled, true);
});

test("the centre control of an extra record follows the same rules as the main record", () => {
  const on = { supervisor: "on", stale: false, pending: null } as const;
  const extra = main("running", { state: "working" }, "extra");
  const expected = controlFor(main("running", { state: "working" }), on);
  assert.deepEqual(controlFor(extra, on), expected);
  assert.equal(controlFor(main("stopped", null, "extra"), on)?.kind, "start");
});
