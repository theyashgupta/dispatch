import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import { parsePort } from "../adapters/ttyd.js";
import { DISPATCH_DIR, TTYD_INDEX_PATH } from "../services/paths.js";

const PATCH_TARGET = "new l.WebLinksAddon";
const PATCH_HANDLER =
  "(e,t)=>{if(e.metaKey||e.ctrlKey){const w=window.open();" +
  "if(w){try{w.opener=null}catch(_){}w.location.href=t}}}";

/**
 * Pure patch step: gate ttyd's bundled web-links click handler on cmd/ctrl. Returns null when the
 * patch target's occurrence count isn't exactly 1 (ttyd version drift — Pitfall 2 in
 * 52-RESEARCH.md) so the caller degrades to stock behavior instead of writing a broken artifact.
 */
export function patchIndexHtml(html: string): string | null {
  const count = html.split(PATCH_TARGET).length - 1;
  if (count !== 1) return null;
  return html.replace(PATCH_TARGET, `new l.WebLinksAddon(${PATCH_HANDLER})`);
}

/**
 * Spawn a throwaway ttyd bound to a bogus tmux target, fetch its served index, and kill it. No
 * real tmux session is needed — ttyd serves `/` regardless of whether the WS-attach target exists
 * (52-RESEARCH.md, live-verified). Not detached, so the capture process is always reaped here.
 */
async function captureStockIndex(): Promise<string> {
  const child = spawn(
    "ttyd",
    [
      "-i",
      "127.0.0.1",
      "-p",
      "0",
      "tmux",
      "attach",
      "-t",
      "dispatch-ttyd-index-capture",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  try {
    const port = await parsePort(child);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(5000),
    });
    return await res.text();
  } finally {
    try {
      child.kill();
    } catch {}
  }
}

/**
 * Unlink a stale prior-boot artifact, tolerating ENOENT. A failed provisioning must never leave a
 * previous boot's patched index sitting around to be served against a drifted ttyd binary, so
 * file-existence at spawn time stays a trustworthy signal for spawnTtyd's conditional `-I`.
 */
async function removeStaleArtifact(): Promise<void> {
  try {
    await fsp.unlink(TTYD_INDEX_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

/**
 * Capture ttyd's stock served index, patch the web-links click handler to be modifier-gated, and
 * write it atomically to TTYD_INDEX_PATH. Never throws — mirrors installHookArtifacts's
 * self-healing-every-boot shape: a future `brew upgrade ttyd` re-captures automatically, and any
 * failure (capture error or patch-target drift) degrades to stock ttyd behavior (spawnTtyd omits
 * `-I` when the file is absent) with exactly one boot warning, never a startup crash.
 */
export async function provisionTtydIndex(): Promise<void> {
  await fsp.mkdir(DISPATCH_DIR, { recursive: true, mode: 0o700 });
  let html: string;
  try {
    html = await captureStockIndex();
  } catch (err) {
    console.warn(
      `[ttyd-index] capture failed — cmd+click links disabled: ${(err as Error).message}`,
    );
    await removeStaleArtifact();
    return;
  }
  const patched = patchIndexHtml(html);
  if (patched == null) {
    console.warn(
      "[ttyd-index] patch target not found exactly once — ttyd version drift suspected, cmd+click links disabled",
    );
    await removeStaleArtifact();
    return;
  }
  await writeFileAtomic(TTYD_INDEX_PATH, patched, { mode: 0o644 });
}
