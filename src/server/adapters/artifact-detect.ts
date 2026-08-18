import net from "node:net";
import type { Card, PreviewInfo, Session } from "../../shared/types.js";
import { listPrsForBranch, type PrProbeResult } from "./gh.js";
import { panePidsBySession } from "./tmux.js";
import { listeningPortsBySession, type DiscoveredPort } from "./dev-server.js";
import { store } from "../store/board.store.js";

/**
 * Detection tick cadence. Replaces the 60s Linear-poll piggyback (F-01/F-02) with a dedicated
 * timer so both probes run regardless of Linear configuration or health.
 */
const ARTIFACT_DETECT_INTERVAL_MS = 10_000;

/** Bare-TCP-connect confirmation timeout for a single discovered preview port candidate. */
const PREVIEW_PROBE_TIMEOUT_MS = 500;

/**
 * Bounded ceiling on consecutive detection-tool failures before a signal stops holding
 * last-known-good and falls to "could not check" (`RESIL-02`).
 *
 * @remarks
 * The same threshold `RESIL-01` already uses for three consecutive capture failures, applied here
 * to a second signal. A counter increments ONLY on a genuine detection-tool failure — an
 * `{ ok: false }` result from `listPrsForBranch`, or a `null` return from
 * `panePidsBySession`/`listeningPortsBySession` — never on a `confirmReachable`-rejected
 * candidate, which is a SUCCESSFUL tick that confirmed zero previews and resets the counter
 * instead. The unknown status is set on the first failure so a silent tooling failure is visible
 * at once; the data field is cleared only once the ceiling is reached, so a single blip never
 * wipes last-known-good. The ceiling exists to stop advertising STALE data, so it never applies to
 * a signal some source answered successfully in the same tick — a permanently-failing sibling repo
 * must not delete a live PR its neighbour just fetched.
 * @see docs/ARCHITECTURE.md#resilience-and-reconcile
 */
const PROBE_FAILURE_CEILING = 3;

/**
 * Exponential backoff bounds for retrying a card's PR fan-out after a tick in which NO repo
 * answered, doubling from `ARTIFACT_DETECT_INTERVAL_MS` up to `PR_RETRY_MAX_MS`.
 *
 * @remarks
 * The 10s cadence exists for the healthy path's recovery latency (F-08), but it also means a
 * card with two repos issues one authenticated `gh pr list` per repo every 10s — 12/min per card,
 * unchanged whether `gh` has failed once or a hundred times in a row. A dropped connection or
 * GitHub secondary rate limiting therefore retried at full rate while every retry drove the
 * `RESIL-02` counter toward wiping the card's PR state, and the raised call rate made throttling
 * likelier in the first place: the cadence fed the mechanism that destroyed the signal.
 *
 * Only the PR fan-out backs off — deliberately NOT the loop's own delay, the way `poller.ts` does
 * it. The tick also runs the local `tmux`/`ps`/`lsof` preview scan, whose ~5s worst-case
 * port-change latency was measured against this cadence (F-08); slowing the whole loop because
 * GitHub is unreachable would regress a closed finding to fix an unrelated one. Backoff engages
 * only when NO repo answered, so a workspace with one permanently unresolvable repo (the everyday
 * multi-account case) keeps polling its healthy siblings at full cadence, and any repo answering
 * resets the delay immediately.
 */
const PR_RETRY_MAX_MS = 60_000;

/**
 * Consecutive PR-probe tool-failure count per SESSION id (`ARTIFACT-01`), pruned every tick to
 * live sessions. Keyed per session rather than per card so a failing sibling's streak can never
 * consume the budget of another live session the same card owns.
 */
const prFailureCounts = new Map<string, number>();

/**
 * Earliest epoch ms at which a session's own PR fan-out may run again, set only after a tick in
 * which no repo answered. Pruned every tick to live sessions, like the counter maps. Keyed per
 * session id, same reasoning as `prFailureCounts`.
 */
const prRetryNotBefore = new Map<string, number>();

/**
 * Consecutive preview-probe tool-failure count per SESSION id (`ARTIFACT-01`), pruned every tick
 * to live sessions, same reasoning as `prFailureCounts`.
 */
const previewFailureCounts = new Map<string, number>();

let artifactDetectInFlight: Promise<void> | null = null;

/**
 * Every live-session PAIR ELIGIBLE for this tick's PR / dev-server probe fan-out — every column
 * `sessionsWithTmux()` returns except Done.
 *
 * @remarks
 * Phase 81 keeps a Done card's tmux session alive for days awaiting deferred cleanup, so
 * `sessionsWithTmux()` alone is no longer naturally bounded by "how many agents are actively
 * working" — it grows with the retained-Done population instead (SIG-02/03 x CLEAN-01 x
 * SCALE-01: measured at 60 concurrent `gh pr list` subprocess spawns per ~10s tick for 60
 * awaiting-cleanup cards, with zero cap). Done is a parked column: it has no Restart affordance,
 * and per `docs/superpowers/specs/2026-07-03-agent-kanban-design.md` the card's work is finished
 * there — nothing about a finished card's PR state or dev-server preview can change from further
 * probing (a PR that merges after Done still doesn't gate anything for a card no further work
 * touches), so continuing to spend a subprocess on it every tick buys nothing. Excluding it here
 * is therefore the correct SIGNAL semantics, not just a scale workaround. `gh.ts`'s `-4/-3`
 * session-lost handling in `reconcile.ts` already draws the identical Done-is-different line for
 * a different purpose (`IN-03`), so this is a precedented distinction in this codebase, not a new
 * one. Every OTHER live column (To Do never carries a `tmuxSession` so is never in the input set;
 * in_progress / needs_input / agent_done) keeps probing exactly as before — SIG-02/03/04 and the
 * unknown-vs-confirmed-negative distinction are unchanged for those columns.
 * @remarks (`ARTIFACT-01`) The probed UNIT is now a SESSION, not a card: `sessionsWithTmux()`
 * yields one pair per live session a card owns, so a card with two live siblings is probed twice
 * this tick (once per branch) and a card with none is probed zero times — the same unit shift
 * `reconcile.ts`/`watcher.ts` already made in Phase 91, documented here rather than silently
 * changing what this function's name counts.
 * @see docs/ARCHITECTURE.md#dev-server-preview-detection
 */
function probedSessions(): {
  card: Card;
  session: Session & { tmuxSession: string };
}[] {
  return store.sessionsWithTmux().filter(({ card }) => card.column !== "done");
}

function connectOnce(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}

/**
 * Confirm a discovered port actually accepts a TCP connection before it is advertised as a
 * preview (F-07: a bound-but-unreachable LISTEN-only port is not the same claim as "answers").
 *
 * @remarks
 * The dialled host comes from the candidate's own `lsof`-reported bind address
 * (`dev-server.ts`'s `PROBE_HOSTS_FOR_BIND`), never a hardcoded `127.0.0.1`: discovery accepts an
 * IPv6-loopback bind, a `::1`-only listener refuses an IPv4 connect outright, and a dev server
 * started on `localhost` binds `::1` first under Node 17+'s verbatim DNS default — so assuming IPv4
 * turned a working dev server into a confident "nothing is listening". A bind that maps to both
 * families passes on either, since the claim being confirmed is only that SOMETHING still accepts
 * at `http://localhost:<port>`.
 *
 * Acceptance is TCP handshake completion ALONE — never an HTTP request or status code. An
 * HTTP-status probe would wrongly reject a real dev server whose `/` returns 404 (a common shape
 * for an API-only or SPA dev server with no index route) and would fail a TLS-only dev server
 * outright, whereas a bare connect asserts nothing about the application protocol above it. The
 * accepted limitation: a process wedged past its own accept queue still passes this probe — the
 * same tradeoff `ttyd.ts`'s `probeAdoption` already accepts in this codebase.
 */
async function confirmReachable(
  candidate: DiscoveredPort,
  timeoutMs = PREVIEW_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const results = await Promise.all(
    candidate.probeHosts.map((host) =>
      connectOnce(host, candidate.port, timeoutMs),
    ),
  );
  return results.some(Boolean);
}

/**
 * Fan out the combined per-session artifact detection (PR lookup + dev-server preview scan) across
 * every PROBED live session (see {@link probedSessions} — every live column except Done),
 * driven by this module's own self-rescheduling ~10s loop.
 *
 * @remarks
 * The single-flight guard enforces nothing on the timer path and is kept for future callers.
 * `scheduleNext()` runs in the awaited tick's `finally`, so a slow tick delays the next one rather
 * than overlapping it, and `tick()` is the only caller — `artifactDetectInFlight` is therefore never
 * non-`null` when tested today. It survives because a non-timer trigger is the obvious next step (a
 * "refresh signals now" route, the shape `pollNow()` already has for the Linear poller) and because
 * the earlier `pollOnce()`-driven design genuinely did re-enter. Such a caller must know what it
 * gets: the promise of the tick ALREADY in flight, NOT a fresh scan. One guard covers BOTH probe
 * types in one pass — preview detection is a passenger on the same call, never a second timer or a
 * second in-flight variable.
 * @see docs/ARCHITECTURE.md#dev-server-preview-detection
 */
async function detectCardArtifacts(backendPort: number): Promise<void> {
  if (artifactDetectInFlight != null) return artifactDetectInFlight;

  artifactDetectInFlight = runArtifactDetection(backendPort).finally(() => {
    artifactDetectInFlight = null;
  });
  return artifactDetectInFlight;
}

/**
 * @remarks
 * Per-repo PR outcomes (F-03/F-04): `finalPrs` flattens only the `ok: true` entries, while any
 * `ok: false` entry sets `prsUnknown` to the first failing repo's category and advances
 * `prFailureCounts` (`RESIL-02`) — reset to zero on a tick where every repo answers. Data a repo
 * returned `ok: true` in THIS tick is never discarded, whatever the counter says: it is freshly
 * fetched, not stale, so a session with one succeeding and one permanently-failing repo keeps
 * showing the succeeding repo's PRs alongside the unknown badge indefinitely. The ceiling
 * therefore only governs the case it was written for — NO repo answered — where `holdLastKnownPrs`
 * suppresses the write entirely below `PROBE_FAILURE_CEILING` (last-known-good survives a blip)
 * and lets the empty `finalPrs` through at or above it, so a totally dead probe cannot leave a
 * stale PR on the board forever. Both the `prs` and `prsUnknown` writes carry their own
 * write-skip diff so an unchanged tick never rebroadcasts. A tick where no repo answered also arms
 * `prRetryNotBefore` (see `PR_RETRY_MAX_MS`), which skips the whole PR block on later ticks until
 * the backoff expires — `prsUnknown` is deliberately left standing while skipping, since nothing
 * has been re-checked.
 *
 * Preview exclusion (F-09) is a `Set<number>` built ONCE per tick — `backendPort` plus EVERY live
 * session's `ttydPort`, across every card, not only a probed one's own field — so a stale, freed
 * ttyd port picked up moments later by a DIFFERENT session's real dev server can no longer leak
 * into that session's previews. A discovered candidate that survives the exclusion set still needs
 * a `confirmReachable` pass (F-07) before it becomes a `PreviewInfo`; a discovered-but-unreachable
 * port is a SUCCESSFUL tick that found zero confirmed previews (the `[]` case) and resets
 * `previewFailureCounts` (`RESIL-02`) — only a `null` return from
 * `panePidsBySession`/`listeningPortsBySession` is a genuine tool failure, which advances the
 * counter for every live session, latches `previewsUnknown` on the first failure, and forces
 * `previews` to `[]` once the ceiling is reached.
 *
 * An idle board short-circuits before any subprocess runs: with no PROBED live session (all-Done or
 * genuinely empty) there is nothing to attribute a port to, yet the tick would still spawn
 * `tmux list-panes -a` every 10s forever and — with no tmux server at all — walk the entire
 * tool-failure branch against zero sessions. The three bookkeeping maps are cleared rather than
 * left alone, because the per-tick prune at the bottom is the only thing that normally evicts a
 * torn-down session's streak and this return skips it.
 * @remarks (`ARTIFACT-01`) The unit throughout this function is a SESSION, not a card: the fan-out
 * iterates `probedSessions()` pairs, reads each pair's OWN `session.branch`/`session.workspace`
 * (never `card.branch`, which is only the ACTIVE session's projection), and keys all three
 * bookkeeping maps by the session's own id rather than `card.id` — so a card with two live
 * siblings is probed twice, each against its own branch, and a failing sibling's retry backoff can
 * never consume the other session's `PROBE_FAILURE_CEILING` budget. `store.setPrsIfSession` and its
 * three siblings still take the tmux session NAME as their addressing argument (unchanged by this
 * plan) and resolve the record themselves; they write the session's own field always and mirror
 * onto the card only when that session is the active one, so a non-active sibling's PRs land on
 * its own record and never corrupt the active session's badge.
 */
async function runArtifactDetection(backendPort: number): Promise<void> {
  const probed = probedSessions();
  if (probed.length === 0) {
    prFailureCounts.clear();
    prRetryNotBefore.clear();
    previewFailureCounts.clear();
    return;
  }

  const excludedPorts = new Set<number>([backendPort]);
  for (const { session: rec } of store.sessionsWithTmux()) {
    if (rec.ttydPort != null) excludedPorts.add(rec.ttydPort);
  }

  const panePids = await panePidsBySession();
  let portsBySession: Map<string, DiscoveredPort[]> | null = null;
  if (panePids != null) {
    const sessionNames = new Set(
      probed.map(({ session }) => session.tmuxSession),
    );
    const narrowed = new Map(
      [...panePids].filter(([session]) => sessionNames.has(session)),
    );
    portsBySession = await listeningPortsBySession(narrowed);
  }

  await Promise.all(
    probed.map(async ({ card, session: rec }) => {
      const session = rec.tmuxSession;

      if (
        rec.branch != null &&
        rec.workspace != null &&
        Date.now() >= (prRetryNotBefore.get(rec.id) ?? 0)
      ) {
        const branch = rec.branch;
        const repos = rec.workspace.repos;
        const results = await Promise.all(
          repos.map((repo) => listPrsForBranch(repo.path, branch)),
        );
        const answered = results.filter(
          (r): r is Extract<PrProbeResult, { ok: true }> => r.ok,
        );
        const failed = results.filter(
          (r): r is Extract<PrProbeResult, { ok: false }> => !r.ok,
        );
        const finalPrs = answered.flatMap((r) => r.prs);
        let holdLastKnownPrs = false;

        if (failed.length > 0) {
          const count = (prFailureCounts.get(rec.id) ?? 0) + 1;
          prFailureCounts.set(rec.id, count);
          const category = failed[0].category;
          if (rec.prsUnknown?.category !== category) {
            await store.setPrsUnknownIfSession(card.id, session, {
              category,
            });
          }
          holdLastKnownPrs =
            answered.length === 0 && count < PROBE_FAILURE_CEILING;
          if (answered.length === 0) {
            prRetryNotBefore.set(
              rec.id,
              Date.now() +
                Math.min(
                  ARTIFACT_DETECT_INTERVAL_MS * 2 ** count,
                  PR_RETRY_MAX_MS,
                ),
            );
          } else {
            prRetryNotBefore.delete(rec.id);
          }
        } else {
          prFailureCounts.delete(rec.id);
          prRetryNotBefore.delete(rec.id);
          if (rec.prsUnknown != null) {
            await store.setPrsUnknownIfSession(card.id, session, null);
          }
        }

        if (
          !holdLastKnownPrs &&
          JSON.stringify(rec.prs ?? []) !== JSON.stringify(finalPrs)
        ) {
          await store.setPrsIfSession(card.id, session, finalPrs);
        }
      }

      if (portsBySession == null) {
        const count = (previewFailureCounts.get(rec.id) ?? 0) + 1;
        previewFailureCounts.set(rec.id, count);
        if (rec.previewsUnknown?.category !== "detection unavailable") {
          await store.setPreviewsUnknownIfSession(card.id, session, {
            category: "detection unavailable",
          });
        }
        if (
          count >= PROBE_FAILURE_CEILING &&
          JSON.stringify(rec.previews ?? []) !== "[]"
        ) {
          await store.setPreviewsIfSession(card.id, session, []);
        }
        return;
      }

      previewFailureCounts.delete(rec.id);
      if (rec.previewsUnknown != null) {
        await store.setPreviewsUnknownIfSession(card.id, session, null);
      }

      const discovered = portsBySession.get(session) ?? [];
      const candidates = discovered.filter(
        (candidate) => !excludedPorts.has(candidate.port),
      );
      const reachable = await Promise.all(
        candidates.map((candidate) => confirmReachable(candidate)),
      );
      const next: PreviewInfo[] = candidates
        .filter((_candidate, i) => reachable[i])
        .map(({ port }) => ({ port, url: `http://localhost:${port}` }));
      if (JSON.stringify(rec.previews ?? []) === JSON.stringify(next)) return;
      await store.setPreviewsIfSession(card.id, session, next);
    }),
  );

  const liveIds = new Set(probedSessions().map(({ session }) => session.id));
  for (const id of prFailureCounts.keys()) {
    if (!liveIds.has(id)) prFailureCounts.delete(id);
  }
  for (const id of prRetryNotBefore.keys()) {
    if (!liveIds.has(id)) prRetryNotBefore.delete(id);
  }
  for (const id of previewFailureCounts.keys()) {
    if (!liveIds.has(id)) previewFailureCounts.delete(id);
  }
}

/**
 * Start the unconditional artifact-detection loop. Runs regardless of Linear configuration or
 * health (closes F-01/F-02), self-rescheduling on its own ~10s cadence rather than piggybacking on
 * the 60s Linear poll.
 * @remarks Mirrors `startMarkerWatcher`'s tick/scheduleNext/unref/immediate-first-run shape
 * exactly: a self-rescheduling `setTimeout` (never a fixed-interval timer, which could overlap a
 * slow tick), `timer.unref?.()` so it never pins the process, and a per-tick try/catch so one
 * failure never kills the loop. `backendPort` arrives as a plain parameter rather than an
 * infra-layer config lookup — `adapters` may import only `adapters`/`sources`/`store`/`shared`.
 * @see docs/ARCHITECTURE.md#dev-server-preview-detection
 */
export function startArtifactDetectionLoop(backendPort: number): void {
  async function tick(): Promise<void> {
    try {
      await detectCardArtifacts(backendPort);
    } catch (err) {
      console.error(
        `[artifact-detect] tick failed — continuing: ${(err as Error).message}`,
      );
    } finally {
      scheduleNext();
    }
  }

  function scheduleNext(): void {
    const timer = setTimeout(() => void tick(), ARTIFACT_DETECT_INTERVAL_MS);
    timer.unref?.();
  }

  void tick();
}
