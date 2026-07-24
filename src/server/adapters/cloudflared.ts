import { spawn, execFile, type ChildProcess } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * RFC 2606 reserved TLD, guaranteed never a real DNS host — the fixed non-loopback Host value
 * `cloudflared --http-host-header` rewrites onto EVERY request it forwards to the local origin
 * (live-verified: even a client-supplied `Host: 127.0.0.1`/the real tunnel host is overwritten).
 * This makes `isLocalRequest` classify all tunnel traffic non-loopback unconditionally, closing
 * CR-01. Also the boot-sweep fingerprint substring (see {@link sweepStrayTunnels}).
 * @remarks T-74-01.
 * @see docs/ARCHITECTURE.md#security-threat-model
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
 * (TUNNEL-04). `--no-autoupdate` stops cloudflared from swapping its own binary mid-session.
 *
 * Every failure path (parse timeout, spawn `error`, early `exit`) SIGTERMs the child and drops the
 * module handle before rejecting, so a slow-but-alive cloudflared can never outlive the enable that
 * spawned it and become an untracked public ingress no `killTunnel`/shutdown can reach. A late URL
 * from a child that is no longer the tracked handle (superseded by a disable/re-enable) is likewise
 * killed rather than adopted. The stderr accumulator is detached the instant the promise settles so
 * a long-lived tunnel does not grow it unbounded. The `exit`/`error` listeners stay live after the
 * URL resolves so a later unexpected exit invokes {@link onTunnelDrop}'s callback.
 */
export function spawnTunnel(localPort: number): Promise<string> {
  if (child) {
    return Promise.reject(
      new Error(
        "cloudflared child already tracked — refusing to spawn a second",
      ),
    );
  }
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

    const settle = () => {
      settled = true;
      clearTimeout(timer);
      proc.stderr?.off("data", onData);
    };

    const killProc = () => {
      try {
        proc.kill("SIGTERM");
      } catch {}
      if (child === proc) child = null;
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settle();
      killProc();
      reject(new Error("cloudflared did not report a URL within 15s"));
    }, TUNNEL_PARSE_TIMEOUT_MS);

    const onData = (d: Buffer) => {
      if (settled) return;
      buf += d.toString();
      const m = buf.match(TUNNEL_URL_RE);
      if (!m) return;
      settle();
      buf = "";
      if (child !== proc) {
        killProc();
        reject(
          new Error("cloudflared tunnel superseded before it reported a URL"),
        );
        return;
      }
      resolve(m[0]);
    };
    proc.stderr?.on("data", onData);

    proc.once("error", (err) => {
      if (settled) return;
      settle();
      if (child === proc) child = null;
      reject(err);
    });

    proc.once("exit", (code) => {
      if (!settled) {
        settle();
        if (child === proc) child = null;
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

/**
 * Boot-time orphan sweep (opposite of `ttyd.ts`'s `adoptAndSweep`): kill every stray `cloudflared`
 * process carrying THIS process's exact sentinel argv, never adopt. A surviving tunnel from a
 * crashed prior boot is a live, unauthenticated public shell — there is no scenario where reusing
 * it is correct. Matches on `basename(argv[0]) === "cloudflared"` AND the exact
 * {@link TUNNEL_HOST_SENTINEL} substring (never binary-name alone) so an unrelated cloudflared the
 * user runs for their own purposes is never touched. Tolerant of `ps` failure (returns 0).
 * @remarks T-74-04.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export async function sweepStrayTunnels(): Promise<number> {
  let out: string;
  try {
    ({ stdout: out } = await execFileP("ps", ["-axww", "-o", "pid=,command="]));
  } catch {
    return 0;
  }
  let killed = 0;
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid || pid === process.ppid) continue;
    const argv = m[2].trim().split(/\s+/);
    if (path.basename(argv[0]) !== "cloudflared") continue;
    if (!m[2].includes(TUNNEL_HOST_SENTINEL)) continue;
    try {
      process.kill(pid, "SIGTERM");
      killed++;
    } catch {}
  }
  return killed;
}
