import { call, WAIT_CALL_MS } from "../replay.js";
import { readyRows } from "../scenario-1/status-rows.js";

interface CentrePlan {
  quickFix: string;
  feature: string;
  transcriptPath: string;
  replayLog: string;
  waits: number;
}

export const QUICK_FIX_PLAYBOOK = "Write code directly";
export const FEATURE_PLAYBOOK = "PRD + Ralph Loop";
export const ORCHESTRATOR_REPLY = "Noted. CEN-1 goes first.";

/**
 * The main orchestrator replay: raise a plan decision with two entries, wait for the answer, then start both cards.
 *
 * @remarks The fake TUI answers every typed line with the same reply, so the kickoff and the user comment each leave
 * a user entry and an orchestrator reply in the transcript that the conversation route reads.
 */
export function centreScenario(plan: CentrePlan): Record<string, unknown> {
  const waits = Array.from({ length: plan.waits }, () =>
    call(
      "wait_for_event",
      { since: 0, kinds: ["decision_answered"], timeoutSeconds: 55 },
      { timeoutMs: WAIT_CALL_MS },
    ),
  );
  return {
    statusRows: readyRows(),
    reply: ORCHESTRATOR_REPLY,
    transcriptPath: plan.transcriptPath,
    replayLogPath: plan.replayLog,
    replay: {
      onStart: [
        { sleepMs: 2500 },
        call("read_state", {}),
        call("get_rulebook", {}),
        call("list_cards", {}),
        call("create_decision_item", {
          kind: "plan",
          question: [
            "Approve this plan?",
            `${plan.quickFix}, ${QUICK_FIX_PLAYBOOK}, order 1, small.`,
            `${plan.feature}, ${FEATURE_PLAYBOOK}, order 2, medium.`,
          ].join("\n"),
          options: [
            { id: "approve", label: "Approve" },
            { id: "reject", label: "Reject" },
          ],
          plan: {
            entries: [
              {
                ref: plan.quickFix,
                playbook: QUICK_FIX_PLAYBOOK,
                order: 1,
                size: "small",
              },
              {
                ref: plan.feature,
                playbook: FEATURE_PLAYBOOK,
                order: 2,
                size: "medium",
              },
            ],
          },
        }),
        ...waits,
        call("start_card", {
          cardId: plan.quickFix,
          playbook: QUICK_FIX_PLAYBOOK,
          direction: "Fix the one known bug and report done.",
        }),
        call("start_card", {
          cardId: plan.feature,
          playbook: FEATURE_PLAYBOOK,
          direction: "Build the feature and report done.",
        }),
        call("write_state", { markdown: "both cards started" }),
      ],
    },
  };
}
