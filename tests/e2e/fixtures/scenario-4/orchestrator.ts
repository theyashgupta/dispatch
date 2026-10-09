import { call, WAIT_CALL_MS } from "../replay.js";
import { readyRows } from "../scenario-1/status-rows.js";

interface OrchestratorPlan {
  repo: string;
  members: string[];
  title: string;
  replayLog: string;
  waits: number;
}

/**
 * The main orchestrator replay: create and start a group, ask for the ship go-ahead, then ship it.
 *
 * @remarks The group card id and its branch come from the saved result of `create_group`, so the replay needs no id up front.
 * A replay cannot branch, so the go-ahead is a decision item followed by repeated waits for its answer.
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
        call("get_policy", {}, { expect: { contains: '"playbooks"' } }),
        call("list_cards", {}),
        call(
          "create_group",
          {
            title: plan.title,
            memberIds: plan.members,
            repos: [{ path: plan.repo, base: "main" }],
            direction: "Build the two tickets and report done.",
          },
          { saveAs: "g" },
        ),
        call("start_group", { id: "$g.card.id" }),
        call("create_decision_item", {
          kind: "other",
          question: "The group is built. Ship it now?",
          options: [
            { id: "ship", label: "Ship the group" },
            { id: "hold", label: "Hold the ship" },
          ],
          recommendedOptionId: "ship",
        }),
        ...waits,
        call("start_ship", {
          cardId: "$g.card.id",
          repository: plan.repo,
          branches: [
            {
              name: "$g.card.id",
              title: "feat: no loop group",
              body: "What: the group work\nWhy: the group finished\nHow: shipped by the orchestrator",
            },
          ],
        }),
        { sleepMs: 40_000 },
        call(
          "get_ship_state",
          { cardId: "$g.card.id" },
          { expect: { contains: '"state":"done"' } },
        ),
        call("write_state", { markdown: "the group shipped" }),
      ],
    },
  };
}
