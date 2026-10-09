import type { Step } from "./loop-files.js";
import { readyRows } from "./status-rows.js";

interface OrchestratorPlan {
  repo: string;
  alpha: { title: string; members: string[]; branch: string };
  beta: { title: string; members: string[]; branch: string };
  replayLog: string;
  gateWaits: number;
}

const CALL_MS = 120_000;
const WAIT_CALL_MS = 400_000;

const call = (
  tool: string,
  args: Record<string, unknown>,
  rest: Step = {},
) => ({
  tool,
  args,
  timeoutMs: CALL_MS,
  ...rest,
});

function groupSteps(plan: OrchestratorPlan, side: "alpha" | "beta"): Step[] {
  const group = plan[side];
  const ref = side === "alpha" ? "ga" : "gb";
  return [
    call(
      "create_group",
      {
        title: group.title,
        memberIds: group.members,
        repos: [{ path: plan.repo, base: "main" }],
        direction: `Run the ${side} roadmap loop.`,
      },
      { saveAs: ref },
    ),
    call("start_group", { id: `$${ref}.card.id` }),
  ];
}

function shipSteps(plan: OrchestratorPlan, side: "alpha" | "beta"): Step[] {
  const group = plan[side];
  const ref = side === "alpha" ? "ga" : "gb";
  return [
    call("start_ship", {
      cardId: `$${ref}.card.id`,
      repository: plan.repo,
      branches: [
        {
          name: group.branch,
          title: `feat: ${side} unit`,
          body: `What: the ${side} unit\nWhy: the ${side} group finished\nHow: shipped by the orchestrator`,
        },
      ],
    }),
    { sleepMs: 40_000 },
    call(
      "get_ship_state",
      { cardId: `$${ref}.card.id` },
      { expect: { contains: '"state":"done"' } },
    ),
  ];
}

/**
 * The main orchestrator replay: read, create and start both groups, ask for the ship go-ahead, then ship each group in turn.
 *
 * @remarks A replay cannot branch, so the go-ahead is a decision item followed by repeated waits for its answer;
 * once the answer exists every remaining wait returns at once.
 */
export function orchestratorScenario(
  plan: OrchestratorPlan,
): Record<string, unknown> {
  const waits = Array.from({ length: plan.gateWaits }, () =>
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
        call("get_policy", {}),
        call("list_cards", {}),
        ...groupSteps(plan, "alpha"),
        ...groupSteps(plan, "beta"),
        call("create_decision_item", {
          kind: "other",
          question: "Both groups are built. Ship them now?",
          options: [
            { id: "ship", label: "Ship both groups" },
            { id: "hold", label: "Hold the ship" },
          ],
          recommendedOptionId: "ship",
        }),
        ...waits,
        ...shipSteps(plan, "alpha"),
        ...shipSteps(plan, "beta"),
        call("write_state", { markdown: "both groups shipped" }),
      ],
    },
  };
}
