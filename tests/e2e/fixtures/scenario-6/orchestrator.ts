import { call, WAIT_CALL_MS } from "../replay.js";
import { readyRows } from "../scenario-1/status-rows.js";

interface OrchestratorPlan {
  repo: string;
  quickFix: string;
  feature: string;
  related: string[];
  groupTitle: string;
  replayLog: string;
  waits: number;
}

export const QUICK_FIX_PLAYBOOK = "Write code directly";
export const FEATURE_PLAYBOOK = "PRD + Ralph Loop";
export const GROUP_PLAYBOOK = "Roadmap Loop";
export const REFUSED_PAUSE_MS = 40_000;

/** The plan text of the decision item, one line for each ticket or ticket group. */
const planQuestion = (plan: OrchestratorPlan): string =>
  [
    "Approve this plan?",
    `${plan.quickFix} alone, ${QUICK_FIX_PLAYBOOK}, order 1, small.`,
    `${plan.feature} alone, ${FEATURE_PLAYBOOK}, order 2, medium.`,
    `${plan.related.join(" and ")} as one group, ${GROUP_PLAYBOOK}, order 3, large.`,
  ].join("\n");

/**
 * The main orchestrator replay: read the rule book, ask for the plan, then start three loops inside a cap of 2.
 *
 * @remarks A replay cannot branch, so the plan answer is a decision item followed by repeated waits for it. The first
 * `start_group` runs with two loops at the cap and must be refused. The pause after it holds the replay while the test
 * moves the quick fix card to Agent done, which frees a slot for the second `start_group`.
 */
export function orchestratorScenario(
  plan: OrchestratorPlan,
): Record<string, unknown> {
  const waits = Array.from({ length: plan.waits }, () =>
    call(
      "wait_for_event",
      { since: 0, kinds: ["decision_answered"], timeoutSeconds: 55 },
      { timeoutMs: WAIT_CALL_MS },
    ),
  );
  return {
    statusRows: readyRows(),
    reply: "ok",
    replayLogPath: plan.replayLog,
    replay: {
      onStart: [
        { sleepMs: 2500 },
        call("read_state", {}),
        call(
          "get_rulebook",
          {},
          { expect: { contains: "Orchestration rule book" } },
        ),
        call(
          "list_playbooks",
          {},
          { expect: { contains: QUICK_FIX_PLAYBOOK } },
        ),
        call("list_playbooks", {}, { expect: { contains: GROUP_PLAYBOOK } }),
        call("list_cards", {}),
        call(
          "create_decision_item",
          {
            kind: "other",
            question: planQuestion(plan),
            options: [
              { id: "approve", label: "Approve the plan" },
              { id: "reject", label: "Reject the plan" },
            ],
            recommendedOptionId: "approve",
          },
          { saveAs: "plan" },
        ),
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
        call(
          "create_group",
          {
            title: plan.groupTitle,
            memberIds: plan.related,
            repos: [{ path: plan.repo, base: "main" }],
            playbook: GROUP_PLAYBOOK,
            direction: "Build the two related tickets as one stack.",
          },
          { saveAs: "g" },
        ),
        call(
          "start_group",
          { id: "$g.card.id" },
          { expect: { isError: true, contains: "policy-refused" } },
        ),
        { sleepMs: REFUSED_PAUSE_MS },
        call(
          "start_group",
          { id: "$g.card.id" },
          { expect: { contains: "started" } },
        ),
        call("write_state", { markdown: "the three loops started" }),
      ],
    },
  };
}
