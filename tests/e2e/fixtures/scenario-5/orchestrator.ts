import { waitKeys } from "../scenario-1/loop-files.js";
import { call, WAIT_CALL_MS } from "../replay.js";
import { readyRows } from "../scenario-1/status-rows.js";

interface OrchestratorPlan {
  repo: string;
  members: string[];
  title: string;
  replayLog: string;
  statusLog: string;
  transcriptPath: string;
}

const WAKE_WAIT_MS = 60_000;
const BUSY_MARK = "esc to interrupt";

/** The two status rows of a pane whose turn is running, which the wake rule treats as busy. */
const busyRows = (): string[] => [`  ${BUSY_MARK}`, ...readyRows().slice(1)];

/** Whether a logged set of status rows is the busy set. */
export const isBusy = (rows: unknown): boolean =>
  Array.isArray(rows) && rows.some((r) => String(r).includes(BUSY_MARK));

/**
 * The main orchestrator replay: create and start a group, then work only when a wake line arrives.
 *
 * @remarks Tool steps run under busy status rows and each wait runs under idle rows, the way a real
 * session shows a running turn and a prompt that waits. A replay cannot branch, so the first wait expects
 * the decision wake line and the second the Agent done wake line. The sleeps hold a queued wake back
 * through the busy windows and let a wake send finish in the idle windows.
 */
export function orchestratorScenario(
  plan: OrchestratorPlan,
): Record<string, unknown> {
  return {
    statusRows: readyRows(),
    reply: "ok",
    replayLogPath: plan.replayLog,
    statusLogPath: plan.statusLog,
    transcriptPath: plan.transcriptPath,
    replay: {
      onStart: [
        { statusRows: busyRows() },
        { sleepMs: 2500 },
        call("read_state", {}),
        call("get_policy", {}, { expect: { contains: '"playbooks"' } }),
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
          question: "Start the build of the group?",
          options: [
            { id: "go", label: "Go" },
            { id: "hold", label: "Hold" },
          ],
          recommendedOptionId: "go",
        }),
        { sleepMs: 5000 },
        { statusRows: readyRows() },
        waitKeys("^Dispatch wake: decision", WAKE_WAIT_MS),
        { sleepMs: 3000 },
        { statusRows: busyRows() },
        call("list_events", { since: 0 }),
        { sleepMs: 4000 },
        { statusRows: readyRows() },
        waitKeys("agent_done", 2 * WAKE_WAIT_MS),
        { sleepMs: 3000 },
        { statusRows: busyRows() },
        call("start_ship", {
          cardId: "$g.card.id",
          repository: plan.repo,
          branches: [
            {
              name: "$g.card.id",
              title: "feat: woken group",
              body: "What: the group work\nWhy: the group finished\nHow: shipped by the woken orchestrator",
            },
          ],
        }),
        { sleepMs: 40_000 },
        call(
          "get_ship_state",
          { cardId: "$g.card.id" },
          { expect: { contains: '"state":"done"' }, timeoutMs: WAIT_CALL_MS },
        ),
        { statusRows: readyRows() },
      ],
    },
  };
}
