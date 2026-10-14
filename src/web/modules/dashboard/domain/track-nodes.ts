import { loopView } from "../../../../shared/loop-view.js";
import type { LoopProgress, LoopUnit } from "../../../../shared/types.js";
import { clock } from "./usage-meters.js";

export type NodeState =
  "done" | "current" | "blocked" | "failed" | "next" | "later";

export interface TrackNode {
  unit: number;
  name: string;
  state: NodeState;
  stateLine: string;
  accessibleName: string;
  phase: { passed: number; total: number } | null;
}

function doneLine(unit: LoopUnit, timeZone: string | undefined): string {
  const latest = unit.phases
    .flatMap((phase) => (phase.passedAt === null ? [] : [phase.passedAt]))
    .filter((at) => !Number.isNaN(Date.parse(at)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const time = latest === undefined ? null : clock(latest, timeZone, false);
  return time === null ? "Done" : `Done ${time}`;
}

function currentNode(
  progress: LoopProgress,
  unit: LoopUnit,
): Pick<TrackNode, "state" | "stateLine" | "phase"> {
  const { currentUnit, currentPhase } = progress.summary;
  if (unit.number !== currentUnit) {
    return { state: "blocked", stateLine: "Blocked", phase: null };
  }
  const total = unit.phaseTotal ?? unit.phases.length;
  const passed = Math.min(
    unit.phases.filter((phase) => phase.gate === "pass").length,
    total,
  );
  let stateLine = "In progress";
  if (currentPhase !== null) {
    stateLine =
      total === 0
        ? `Phase ${currentPhase.number}`
        : `Phase ${currentPhase.number} of ${total}`;
  }
  return {
    state: "current",
    stateLine,
    phase: total > 0 ? { passed, total } : null,
  };
}

/**
 * Builds the unit nodes of the progress track.
 *
 * @remarks Node states come from the loop view segments. The first pending unit reads "next" and the
 * rest read "later".
 */
export function trackNodes(
  progress: LoopProgress,
  opts: { timeZone?: string },
): TrackNode[] {
  const { segments } = loopView(progress, opts);
  let nextTaken = false;
  return progress.units.flatMap((unit, i): TrackNode[] => {
    const segment = segments[i];
    if (segment === undefined) return [];
    const base = {
      unit: unit.number,
      name: unit.title,
      accessibleName: segment.accessibleName,
    };
    switch (segment.state) {
      case "done":
        return [
          {
            ...base,
            state: "done",
            stateLine: doneLine(unit, opts.timeZone),
            phase: null,
          },
        ];
      case "current":
        return [{ ...base, ...currentNode(progress, unit) }];
      case "failed gate":
        return [
          {
            ...base,
            state: "failed",
            stateLine: "Gate failed",
            phase: null,
          },
        ];
      case "pending": {
        const first = !nextTaken;
        nextTaken = true;
        return [
          {
            ...base,
            state: first ? "next" : "later",
            stateLine: first ? "Next" : "Later",
            phase: null,
          },
        ];
      }
    }
  });
}
