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

/** The current tunnel status, as broadcast over the `tunnel` SSE frame. */
export function getTunnelState(): TunnelState {
  return status;
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
  status = { status: "starting" };

  const presence = await checkCloudflaredPresence();
  if (!presence.present) {
    status = {
      status: "binary-missing",
      installHint: presence.hint ?? "brew install cloudflared",
    };
    return;
  }

  try {
    const url = await spawnTunnel(localPort);
    const code = mintToken();
    status = { status: "on", url, code };
    onTunnelDrop(() => {
      status = { status: "error", message: "cloudflared exited unexpectedly" };
    });
  } catch (err) {
    status = { status: "error", message: (err as Error).message };
  }
}

/** Kill the tunnel child, clear the token, and reset to `off`. Idempotent. */
export function disableTunnel(): void {
  onTunnelDrop(null);
  killTunnel();
  clearToken();
  status = { status: "off" };
}
