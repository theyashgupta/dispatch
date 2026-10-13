import { LOGIN_EXPIRY_WARN_MS } from "../../../shared/account-chain.js";

/**
 * Tell whether a login expiry is close enough to warn about and not yet warned about.
 *
 * @remarks An expiry already in the past warns too, since the account needs a new login. The
 * notified value is the expiry that was last warned about for the account, so a new login gives a
 * new value and a new warning.
 */
export function shouldWarnLoginExpiry(
  loginExpiresAt: string,
  notified: string | undefined,
  now: number,
): boolean {
  return (
    loginExpiresAt !== notified &&
    Date.parse(loginExpiresAt) - now <= LOGIN_EXPIRY_WARN_MS
  );
}
