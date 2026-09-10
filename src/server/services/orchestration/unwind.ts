import { store } from "../../store/board.store.js";
import type {
  ArchivedGroup,
  UnwindDestination,
} from "../../../shared/types.js";
import { killSessionProcesses } from "./cleanup.js";

export type UnwindOutcome =
  | { ok: true; row: ArchivedGroup }
  | { ok: false; status: 404 | 409; error: string };

/**
 * Unwind a group (LOCAL-17): kill its sessions, then archive, unlink and move in one store mutation.
 * @remarks Resolves the group from the group card or any member and refuses while a start, resume
 * or cleanup saga holds it. Kills happen before the mutation so the snapshot never claims a live
 * tmux name; a kill that finds nothing is a no-op, so a half-dead group unwinds the same way.
 * The kill window is bracketed by the card-scoped cleanup guard, so a resume, cleanup or second
 * unwind cannot interleave with it, and the store mutator re-checks the start guard itself.
 * @see docs/ARCHITECTURE.md#unwind-and-archive
 */
export async function unwindGroup(
  cardId: string,
  destination: UnwindDestination,
): Promise<UnwindOutcome> {
  const card = store.getCard(cardId);
  if (!card)
    return { ok: false, status: 404, error: `unknown card id: ${cardId}` };
  const group =
    card.source === "group"
      ? card
      : card.groupId != null
        ? store.getCard(card.groupId)
        : undefined;
  if (!group || group.source !== "group") {
    return { ok: false, status: 409, error: "only a group can be unwound" };
  }
  if (store.isStarting(group.id)) {
    return {
      ok: false,
      status: 409,
      error: "a start or resume is in flight for this group",
    };
  }
  if (store.isCleaningUp(group.id)) {
    return {
      ok: false,
      status: 409,
      error: "cleanup is in flight for this group",
    };
  }
  store.beginCleanup(group.id);
  try {
    const names = (group.sessions ?? []).map((s) => s.tmuxSession);
    if (names.length === 0) names.push(group.tmuxSession);
    for (const name of names) await killSessionProcesses(name);
    const result = await store.unwindGroup(group.id, destination);
    return result.ok
      ? result
      : { ok: false, status: 409, error: result.reason };
  } finally {
    store.endCleanup(group.id);
  }
}
