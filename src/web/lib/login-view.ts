import {
  MAX_LOGIN_CODE_LEN,
  type ClaudeLoginView,
} from "../../shared/types.js";

/**
 * Whether a pasted code is submittable: non-empty after trimming, one line, within the server's
 * length cap.
 */
export function isSubmittableCode(raw: string): boolean {
  const code = raw.trim();
  return (
    code !== "" && !/[\r\n]/.test(code) && code.length <= MAX_LOGIN_CODE_LEN
  );
}

/**
 * Whether the server still has this login moving; `idle`, `done` and `error` are terminal for
 * polling purposes.
 */
export function loginInFlight(state: ClaudeLoginView): boolean {
  return (
    state.state === "starting" ||
    state.state === "awaiting-code" ||
    state.state === "finishing"
  );
}

/**
 * The account id a server login view is about, null for `idle` and `error`.
 */
export function viewAccountId(state: ClaudeLoginView): string | null {
  if ("accountId" in state) return state.accountId;
  if (state.state === "done") return state.account.id;
  return null;
}

/**
 * Decide whether a polled view belongs to another window's login.
 * @remarks `ownId` is the id this window's own start received (or its re-login target) and
 * `startsPending` says whether a start of ours is still unanswered. A view with a different id is
 * foreign. A view with an id when we hold none is foreign only once no start of ours can still
 * answer; while one is pending the view may be our own start echoed back before its 202 arrived.
 */
export function isForeignLogin(
  ownId: string | null,
  seenId: string | null,
  startsPending: boolean,
): boolean {
  if (seenId === null) return false;
  if (ownId !== null) return seenId !== ownId;
  return !startsPending;
}

/**
 * Whether two server views are the same for rendering purposes, so a poll that changes nothing
 * does not re-render or re-arm effects.
 */
export function sameLoginView(a: ClaudeLoginView, b: ClaudeLoginView): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
