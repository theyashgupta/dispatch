import { EventEmitter } from "node:events";
import type { TunnelState } from "../../../shared/types.js";
import {
  killTunnel,
  onTunnelDrop,
  spawnTunnel,
} from "../../adapters/cloudflared.js";
import { checkCloudflaredPresence } from "../infra/preflight.js";
import { clearToken, mintToken } from "../infra/remote-auth.js";

/** Runtime-only tunnel status. In memory, never persisted (matches remote-auth.ts's contract). */
let status: TunnelState = { status: "off" };

/** The hostname of the currently-live tunnel URL, or null when off — read by the GATE-04 CSRF fix. */
let publicHost: string | null = null;

/**
 * Fired with the new {@link TunnelState} on every transition (starting/on/error/binary-missing/
 * off) — `sse.route.ts` subscribes this to the `tunnel` named SSE frame, mirroring the board
 * store's `activity` emitter shape.
 */
export const tunnelEmitter = new EventEmitter();

/** Set the live status and broadcast the transition to every subscriber. */
function setStatus(next: TunnelState): void {
  status = next;
  tunnelEmitter.emit("change", status);
}

/** The current tunnel status, as broadcast over the `tunnel` SSE frame. */
export function getTunnelState(): TunnelState {
  return status;
}

/**
 * The real, currently-live public tunnel hostname (parsed from cloudflared's stderr URL), or null
 * when no tunnel is up. Consumed ONLY by `remote-auth-gate.ts`'s `originMatchesHost`: once
 * cloudflared's `--http-host-header` sentinel rewrites every tunnel request's `Host`, the gate can
 * no longer trust `req.headers.host` for a non-loopback request and must compare against this
 * instead (GATE-04 CSRF fix).
 */
export function getKnownPublicHost(): string | null {
  return publicHost;
}

/**
 * Enable the tunnel: lazily check `cloudflared` presence, spawn it against `localPort`, mint a
 * fresh token, and transition to `on`. Re-entry-guarded — a call while already `starting`/`on` is
 * a no-op, mirroring `start-session.ts`'s in-flight guard. On a later unexpected child exit (the
 * adapter's `onTunnelDrop` callback), transitions to `error` with no auto-retry — the user
 * re-toggles for a fresh tunnel (locked decision).
 */
export async function enableTunnel(localPort: number): Promise<void> {
  if (status.status === "starting" || status.status === "on") return;
  setStatus({ status: "starting" });

  const presence = await checkCloudflaredPresence();
  if (!presence.present) {
    setStatus({
      status: "binary-missing",
      installHint: presence.hint ?? "brew install cloudflared",
    });
    return;
  }

  try {
    const url = await spawnTunnel(localPort);
    publicHost = new URL(url).hostname;
    const code = mintToken();
    setStatus({ status: "on", url, code });
    onTunnelDrop(() => {
      publicHost = null;
      setStatus({
        status: "error",
        message: "cloudflared exited unexpectedly",
      });
    });
  } catch (err) {
    publicHost = null;
    setStatus({ status: "error", message: (err as Error).message });
  }
}

/** Kill the tunnel child, clear the token, and reset to `off`. Idempotent. */
export function disableTunnel(): void {
  onTunnelDrop(null);
  killTunnel();
  clearToken();
  publicHost = null;
  setStatus({ status: "off" });
}
