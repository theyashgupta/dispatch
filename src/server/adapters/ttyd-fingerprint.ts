import { createHash } from "node:crypto";
import { DISPATCH_DATA_DIR } from "../store/data-dir.js";
import path from "node:path";

/**
 * Bumped 5 -> 6 alongside the `-b` base path moving from card-keyed to session-keyed (`PROXY-01`).
 * A ttyd spawned by an earlier build carries a card-keyed `-b`, and adopting it would hand the app
 * a live-looking pane the new session-keyed route cannot address. Old-revision processes fall out
 * of `compatible`, are never re-adopted, and are therefore swept — a deliberate, one-time,
 * user-visible reconnect on first boot after upgrade, never a silent adoption of an unaddressable
 * pane. The re-adoption fingerprint has only NARROWED, per the rule below.
 * @remarks Bumped 6 -> 7 for `TERM-05`: a pre-`-T tmux-256color` ttyd attaches on the wrong TERM,
 * so the no-alt-screen `terminal-overrides` entry never matches it and the client it serves has no
 * local scrollback and no way to self-heal. Same one-time reconnect, same reasoning: swept, never
 * re-adopted.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const TTYD_RUNTIME_REVISION = 7;
const TTYD_RUNTIME_REVISION_KEY = "DISPATCH_TTYD_REVISION";

/**
 * The revision half of the re-adoption fingerprint, `-t`'d as a retained bare key (arbitrary value
 * `1`) rather than in the theme JSON that used to also carry it — that JSON is gone now that the
 * native client owns theme/font. It lives in the KEY, not the value, because ttyd rewrites
 * `=`→space in its proctitle — a value-side revision would split into two separate, ungreppable
 * tokens (RESEARCH.md §4, empirically verified against installed ttyd 1.7.7).
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export const TTYD_RUNTIME_REVISION_RETAINED_KEY = `${TTYD_RUNTIME_REVISION_KEY}_${TTYD_RUNTIME_REVISION}`;

const TTYD_INSTANCE_KEY = "DISPATCH_TTYD_INSTANCE";

/**
 * Short stable id of THIS Dispatch instance, derived from its resolved data directory.
 *
 * @remarks Two instances on one machine (a dev checkout, a sandbox `HOME`, a `DISPATCH_DIR`
 * override) each own a distinct data directory, so hashing it is what keeps their ttyd processes
 * apart in a machine-wide `ps` scan. It hashes `DISPATCH_DATA_DIR`, the one resolver every layer
 * shares, never a re-derived `~/.dispatch`: a literal home path ignores `DISPATCH_DIR`, so two
 * instances under one HOME shared a key and swept each other's terminals on every boot.
 */
const TTYD_INSTANCE_ID = createHash("sha256")
  .update(DISPATCH_DATA_DIR)
  .digest("hex")
  .slice(0, 12);

/**
 * The instance half of the re-adoption fingerprint, `-t`'d exactly like the revision key: identity
 * in the KEY, arbitrary value `1`, for the same `=`→space reason.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export const TTYD_INSTANCE_RETAINED_KEY = `${TTYD_INSTANCE_KEY}_${TTYD_INSTANCE_ID}`;

/**
 * Captures whichever instance id a ttyd proctitle carries, ours or another instance's. Stops at
 * `=` as well as whitespace so an unrewritten `KEY_<id>=1` still yields the bare id.
 */
const INSTANCE_RETAINED_KEY_RE = new RegExp(
  `(?:^|\\s)${TTYD_INSTANCE_KEY}_([^\\s=]+)`,
);

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ownership arm that survives ttyd's proctitle rewrite. ttyd overwrites its own argv buffer at
 * startup (rendering `-t key=value` as `-t key value`), and when an earlier token is large enough
 * to fill that fixed buffer the TRAILING command is dropped outright — a pre-2.7.0 ttyd carrying
 * the retired multi-KB theme JSON shows no `tmux attach` in `ps` at all, empirically confirmed
 * against ttyd 1.7.7. Such a process matched neither the `tmux`+`attach` arm nor the
 * current-revision arm, so it was never swept AND never adopted: it leaked across every restart
 * and upgrade, holding its port and serving its session from the retired patched index forever.
 * `-b /sessions/<sessionId>/terminal` is early enough to always survive the rewrite and is
 * specific enough to be dispatch's own. This widens the SWEEP arm ONLY — `compatible` still
 * demands the exact current revision key, because a re-adoption fingerprint may only ever narrow.
 * The regex itself is agnostic to what the single opaque segment between `/sessions/` and
 * `/terminal` names (a card id, formerly, or a session id, now), so it needs no code change here.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const DSP_BASE_PATH_RE = /(?:^|\s)-b\s+\/sessions\/[^\s/]+\/terminal(?:\s|$)/;

/**
 * Boundary-anchored matcher for the current revision inside a ttyd proctitle. A bare substring
 * `includes` of the retained key would also fire on a future revision 40–49 (`…REVISION_4` is a
 * prefix of `…REVISION_40`), silently adopting a process spawned by an incompatible runtime
 * contract. The trailing `(?!\d)` negative lookahead pins the match to exactly this revision.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
const REVISION_RETAINED_KEY_RE = new RegExp(
  `${escapeRegExp(TTYD_RUNTIME_REVISION_RETAINED_KEY)}(?!\\d)`,
);

/**
 * Classify `ps -axww -o pid=,command=` output into Dispatch ttyd sweep candidates and the subset
 * this instance may re-adopt.
 *
 * @remarks A process carrying ANOTHER instance's key is excluded outright: never swept, never
 * adopted, so two Dispatch instances on one machine leave each other's terminals alone. A process
 * with NO instance key (spawned by a pre-instance-key build) stays sweepable so legacy ttyd are
 * cleaned up once after upgrade. `compatible` demands BOTH the exact current revision key AND our
 * own instance key — the re-adoption fingerprint only ever narrows.
 * @see docs/ARCHITECTURE.md#terminal-ttyd
 */
export function classifyDspTtydProcesses(
  psOutput: string,
  skipPids: ReadonlySet<number>,
): { candidates: Set<number>; compatible: Set<number> } {
  const candidates = new Set<number>();
  const compatible = new Set<number>();
  for (const line of psOutput.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    if (skipPids.has(pid)) continue;
    const argv = m[2].trim().split(/\s+/);
    if (path.basename(argv[0]) !== "ttyd") continue;
    const instanceId = INSTANCE_RETAINED_KEY_RE.exec(m[2])?.[1];
    if (instanceId !== undefined && instanceId !== TTYD_INSTANCE_ID) continue;
    const hasCurrentRevision = REVISION_RETAINED_KEY_RE.test(m[2]);
    if (
      !(argv.includes("tmux") && argv.includes("attach")) &&
      !hasCurrentRevision &&
      !DSP_BASE_PATH_RE.test(m[2])
    )
      continue;
    candidates.add(pid);
    if (hasCurrentRevision && instanceId === TTYD_INSTANCE_ID)
      compatible.add(pid);
  }
  return { candidates, compatible };
}
