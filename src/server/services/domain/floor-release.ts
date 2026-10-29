import { isHiddenCard } from "../../../shared/hidden-card.js";
import type { Card, Session } from "../../../shared/types.js";

/**
 * True when the memory floor may exit Claude in this session of the card.
 *
 * @remarks A card is finished in Agent done or Done, or when its loop engine is closed in any column.
 * An open engine always keeps Claude, and so does a running or stopped ship flow, because a fix
 * instruction can still follow. A session at `needs_input` waits for an answer, which also keeps the
 * target of a `resume_loop` alive.
 */
export function floorReleasable(
  card: Card,
  session: Session,
  starting: boolean,
): boolean {
  const engine = card.loopProgress?.engine;
  const engineOpen = engine?.active === true && !engine.closed;
  const finished =
    card.column === "agent_done" ||
    card.column === "done" ||
    (engine != null && !engineOpen);
  const shipFlow = card.shipFlow?.state;
  return (
    finished &&
    !engineOpen &&
    session.tmuxSession !== undefined &&
    session.state !== "released" &&
    session.state !== "needs_input" &&
    !isHiddenCard(card) &&
    !card.paused &&
    !starting &&
    shipFlow !== "running" &&
    shipFlow !== "stopped"
  );
}
