import type { SourceConnection } from "../../../../shared/types.js";

export type CredentialBusy = "load" | "connect" | "test" | "disconnect" | null;

/**
 * The connection a card shows, given the cached read and whether the latest read failed.
 *
 * @remarks A failed read keeps what the card already knew about the credential and adds the
 * unreachable error, so a dropped request never reads as a source that was never set up.
 */
export function connectionFromRead(
  data: SourceConnection | undefined,
  failed: boolean,
): SourceConnection | null {
  if (!failed) return data ?? null;
  return {
    configured: data?.configured ?? false,
    connected: false,
    ...(data?.enabled !== undefined ? { enabled: data.enabled } : {}),
    ...(data?.account ? { account: data.account } : {}),
    error: "unreachable",
  };
}

/** Whether the card began connected: a failed first read counts as not connected. */
export function startedConnectedFrom(
  data: SourceConnection | undefined,
  failed: boolean,
): boolean {
  return !failed && data?.connected === true;
}
