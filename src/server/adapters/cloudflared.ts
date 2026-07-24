import { spawn, type ChildProcess } from "node:child_process";

/**
 * RFC 2606 reserved TLD, guaranteed never a real DNS host — the fixed non-loopback Host value
 * `cloudflared --http-host-header` rewrites onto EVERY request it forwards to the local origin
 * (live-verified: even a client-supplied `Host: 127.0.0.1`/the real tunnel host is overwritten).
 * This makes `isLocalRequest` classify all tunnel traffic non-loopback unconditionally, closing
 * CR-01. Also the boot-sweep fingerprint substring (added in a later task alongside the sweep).
 */
export const TUNNEL_HOST_SENTINEL = "dispatch.invalid";

const TUNNEL_URL_RE = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

/** Live cold-start was ~8s (research session); budget generously for network variance. */
const TUNNEL_PARSE_TIMEOUT_MS = 15_000;

/** The live cloudflared child, or null when no tunnel is running. Module-level, NOT persisted. */
let child: ChildProcess | null = null;

/** The caller-registered callback for an unexpected exit AFTER the tunnel reached `on`. */
let onDropCallback: (() => void) | null = null;

/**
 * Register a callback fired when the live tunnel's cloudflared child exits unexpectedly (a mid-
 * session drop) — the reachable path for the locked "show error, no auto-retry" decision. Only one
 * callback is tracked at a time (tunnel.ts is the sole caller).
 */
export function onTunnelDrop(cb: (() => void) | null): void {
  onDropCallback = cb;
}

/**
 * Spawn `cloudflared` against the local origin and resolve with the parsed public tunnel URL.
 * The child is never detached and the handle is never released early — the inverse of
 * `adapters/ttyd.ts`'s survive-a-restart lifecycle: cloudflared MUST die with this process so a
 * crash/restart cannot leave a public URL pointing at a server the token no longer recognizes
 * (TUNNEL-04). `--no-autoupdate` stops cloudflared from swapping its own binary mid-session. The
 * child's `exit`/`error` listeners stay live after the URL resolves so a later unexpected exit
 * invokes {@link onTunnelDrop}'s callback.
 */
export function spawnTunnel(localPort: number): Promise<string> {
  const proc = spawn(
    "cloudflared",
    [
      "tunnel",
      "--url",
      `http://127.0.0.1:${localPort}`,
      "--http-host-header",
      TUNNEL_HOST_SENTINEL,
      "--no-autoupdate",
    ],
    { detached: false, stdio: ["ignore", "ignore", "pipe"] },
  );
  child = proc;

  return new Promise((resolve, reject) => {
    let buf = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("cloudflared did not report a URL within 15s"));
    }, TUNNEL_PARSE_TIMEOUT_MS);

    const onData = (d: Buffer) => {
      buf += d.toString();
      const m = buf.match(TUNNEL_URL_RE);
      if (m && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    proc.stderr?.on("data", onData);

    proc.once("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    proc.once("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`cloudflared exited early (${code}): ${buf}`));
        return;
      }
      if (child === proc) {
        child = null;
        onDropCallback?.();
      }
    });
  });
}

/**
 * Best-effort SIGTERM of the live tunnel child and clear the module handle. No adopted-pid
 * branch (unlike `killTtyd`) — cloudflared is never adopted, so there is never a childless entry.
 */
export function killTunnel(): void {
  if (child) {
    try {
      child.kill("SIGTERM");
    } catch {}
    child = null;
  }
}
