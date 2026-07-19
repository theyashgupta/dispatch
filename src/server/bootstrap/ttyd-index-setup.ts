import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import writeFileAtomic from "write-file-atomic";
import { parsePort } from "../adapters/ttyd.js";
import { DISPATCH_DIR, TTYD_INDEX_PATH } from "../services/infra/paths.js";

/**
 * Reverse-tabnabbing-safe modifier-gated link activator, shared verbatim by both cmd-click
 * patches (`cmd-click-weblinks` and `cmd-click-osc8`): open a blank tab, null its opener, THEN
 * navigate — never `window.open(url,"_blank")`, which does not reliably null the opener across
 * browsers. Its `(e,t)` signature matches both WebLinksAddon's click handler shape and xterm's
 * `linkHandler.activate(event, uri)` shape, which is why both patches can reuse it unmodified.
 * The else-branch warn preserves the popup-blocked diagnostic both stock xterm code paths emit
 * when `window.open()` returns null — without it a blocked cmd+click does nothing silently,
 * indistinguishable from an unapplied patch when debugging.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const PATCH_HANDLER =
  "(e,t)=>{if(e.metaKey||e.ctrlKey){const w=window.open();" +
  "if(w){try{w.opener=null}catch(_){}w.location.href=t}" +
  'else console.warn("dispatch: cmd+click open blocked")}}';

/** Existing WebLinksAddon plain-text-link patch anchor (52-RESEARCH.md). */
const PATCH_TARGET = "new l.WebLinksAddon";

/**
 * One named, independently-degrading patch to ttyd's served index: `target` is an exact-count-1
 * literal anchor in the captured stock bundle, `build` returns the full replacement string, and
 * `disabledWarning` names the feature lost when the anchor drifts.
 */
interface NamedPatch {
  name: string;
  target: string;
  build: () => string;
  disabledWarning: string;
}

/**
 * Three independent patches applied to ttyd's served index, in order. Each anchor is checked for
 * an exact-count-1 occurrence before being applied; a drifted anchor skips ONLY that patch, never
 * the others, and is never force-applied via regex or fuzzy matching (59-RESEARCH.md Anchors 1-3).
 * @remarks `cmd-click-osc8` sets `terminal.options.linkHandler` because real Claude Code `⏺`
 * output uses OSC-8 hyperlinks — a different, earlier-registered xterm.js code path than
 * `WebLinksAddon`, which never fires for that output (59-RESEARCH.md Pitfall 1). `shift-enter`
 * sends raw LF via the Dispatcher's own bound `sendData`, never `term.paste` (which silently
 * converts `\n` back into `\r` via xterm's `prepareTextForTerminal` — 59-RESEARCH.md Pitfall 2).
 * Its guards are load-bearing: `e.isComposing` (runs BEFORE xterm's own composition check — IME
 * safety, Pitfall 4) and `e.type==="keyup"` always pass through untouched. On a matching
 * Shift+Enter the handler swallows BOTH the `keydown` AND the following `keypress` for the SAME
 * keystroke (calling `sendData` only once, on `keydown`) — `_keyPress` only short-circuits on
 * `_keyDownHandled`, which xterm sets internally ONLY when its own (not our) keydown handling ran
 * to completion, so an early customKeyEventHandler-return during keydown never sets it; without
 * also swallowing keypress, xterm's stock keypress path independently `triggerDataEvent`s the
 * Enter key's own CR right after our injected LF, submitting the message instead of inserting a
 * newline (live-discovered defect, fixed same-plan, 59-02-SUMMARY.md).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const PATCHES: NamedPatch[] = [
  {
    name: "cmd-click-weblinks",
    target: PATCH_TARGET,
    build: () => `new l.WebLinksAddon(${PATCH_HANDLER})`,
    disabledWarning: "cmd+click links (plain-text fallback) disabled",
  },
  {
    name: "cmd-click-osc8",
    target: "this.terminal=new n.Terminal(this.options.termOptions);",
    build: () =>
      "this.terminal=new n.Terminal(this.options.termOptions);" +
      `this.terminal.options.linkHandler={activate:${PATCH_HANDLER}};`,
    disabledWarning: "cmd+click links (real Claude Code OSC-8 output) disabled",
  },
  {
    name: "shift-enter",
    target: "t.open(e),i.fit()}",
    build: () =>
      "t.open(e),t.attachCustomKeyEventHandler((e=>{" +
      'if(e.isComposing||e.type==="keyup")return!0;' +
      'if(e.key==="Enter"&&e.shiftKey&&!e.ctrlKey&&!e.altKey&&!e.metaKey){' +
      'if(e.type==="keydown")this.sendData("\\n");return!1}return!0})),i.fit()}',
    disabledWarning: "shift+enter newline disabled",
  },
];

/**
 * Apply every patch in PATCHES independently against `html`. A target whose occurrence count
 * isn't exactly 1 (ttyd version drift) skips ONLY that patch and the loop continues — the same
 * "named independent checks, never short-circuit" contract `preflight.ts`'s
 * `REQUIRED_BINARIES`/`probePreflight` already follows for prerequisite checks. Every replacement
 * is a function callback so `$`-patterns in a future patch string are never string-interpolated
 * into the artifact.
 * @remarks Anchor counts run against the ALREADY-MUTATED string in PATCHES order, not the
 * pristine capture — so no patch's `build()` output may contain another patch's anchor substring
 * (holds for the current three, verified against the live bundle), or the later patch's count
 * silently drifts to 0/2 and the boot log misreports it as ttyd version drift.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export function patchIndexHtml(html: string): {
  html: string;
  applied: string[];
  skipped: string[];
} {
  let out = html;
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const patch of PATCHES) {
    const count = out.split(patch.target).length - 1;
    if (count !== 1) {
      skipped.push(patch.name);
      continue;
    }
    out = out.replace(patch.target, () => patch.build());
    applied.push(patch.name);
  }
  return { html: out, applied, skipped };
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
    if (!res.ok) throw new Error(`index fetch returned ${res.status}`);
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
 * file-existence at spawn time stays a trustworthy signal for spawnTtyd's conditional `-I`. Any
 * other unlink error (EACCES/EPERM on ~/.dispatch) warns instead of throwing: the module's
 * never-throws contract wins, and a loud warning is the only remedy left when the
 * artifact-matches-this-boot invariant cannot be enforced.
 */
async function removeStaleArtifact(): Promise<void> {
  try {
    await fsp.unlink(TTYD_INDEX_PATH);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    console.warn(
      `[ttyd-index] stale artifact removal failed — a prior boot's patched index may still be served: ${(err as Error).message}`,
    );
  }
}

/**
 * Capture ttyd's stock served index, apply every patch in PATCHES independently, and write the
 * (possibly partial) result atomically to TTYD_INDEX_PATH whenever at least one patch applied —
 * partial capability beats none (CONTEXT.md). Never throws — mirrors installHookArtifacts's
 * self-healing-every-boot shape: a future `brew upgrade ttyd` re-captures automatically, and any
 * failure (capture error, every patch drifted, or artifact write) degrades to stock ttyd behavior
 * (spawnTtyd omits `-I` when the file is absent) with a boot warning naming each disabled feature,
 * never a startup crash. A failed WRITE also unlinks the prior boot's artifact, preserving the
 * invariant that an existing artifact always matches the ttyd binary this boot captured; the outer
 * catch is the contract's final safety net (mkdir failure, or anything unexpected disabling every
 * patch).
 * @remarks Started fire-and-forget in bootstrap and deliberately NOT awaited: the cold
 * first-ttyd-spawn-per-boot measured ~5s (Pitfall 5), and awaiting it would put that spawn on the
 * serial boot path ahead of listen — the instant-startup constraint forbids that. It must be
 * kicked off strictly AFTER reconcileSessions: the boot orphan sweep's fingerprint
 * (`ttyd … tmux attach`) matches the throwaway capture child, so an overlapping sweep would
 * SIGTERM the capture mid-flight and silently disable every patch for the whole boot. Safe to
 * overlap listen because spawnTtyd re-checks artifact existence per spawn — a terminal opened
 * inside the capture window gets the prior boot's artifact or stock behavior for that one spawn.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export async function provisionTtydIndex(): Promise<void> {
  try {
    await fsp.mkdir(DISPATCH_DIR, { recursive: true, mode: 0o700 });
    let html: string;
    try {
      html = await captureStockIndex();
    } catch (err) {
      console.warn(
        `[ttyd-index] capture failed — cmd+click links and shift+enter newline disabled: ${(err as Error).message}`,
      );
      await removeStaleArtifact();
      return;
    }
    const { html: patched, applied, skipped } = patchIndexHtml(html);
    for (const name of skipped) {
      const patch = PATCHES.find((p) => p.name === name);
      if (patch) {
        console.warn(
          `[ttyd-index] ${patch.disabledWarning} — anchor not found exactly once (ttyd version drift suspected)`,
        );
      }
    }
    if (applied.length === 0) {
      await removeStaleArtifact();
      return;
    }
    try {
      await writeFileAtomic(TTYD_INDEX_PATH, patched, { mode: 0o644 });
    } catch (err) {
      console.warn(
        `[ttyd-index] artifact write failed — cmd+click links and shift+enter newline disabled: ${(err as Error).message}`,
      );
      await removeStaleArtifact();
    }
  } catch (err) {
    console.warn(
      `[ttyd-index] provisioning failed — cmd+click links and shift+enter newline disabled: ${(err as Error).message}`,
    );
  }
}
