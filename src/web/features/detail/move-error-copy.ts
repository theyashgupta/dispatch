/**
 * The panel notice copy for a refused Move to request.
 *
 * @remarks A 502 never reaches here: the server already recorded it as the card notice, so the
 * panel stays silent and the notice shows it.
 */
export function moveErrorCopy(status: number, error: string | null): string {
  if (status === 404) return "This ticket is no longer on the board.";
  if (status === 400)
    return "That state is no longer on the team. Reopen the ticket and try again.";
  if (status === 409)
    return "Linear is not connected, or this card has no Linear team.";
  return error ?? "Could not reach Dispatch. Try again.";
}
