import { DEFAULT_CLAUDE_ACCOUNT_ID } from "../../../shared/types.js";
import {
  readClaudeIdentity,
  type ClaudeIdentity,
} from "../../adapters/claude-cli.js";
import { boardRepository as store } from "../../store/board-repository.js";
import { cacheHomeIdentity } from "./claude-account-ops.js";
import {
  readDefaultIdentity,
  writeDefaultIdentity,
  type DefaultIdentity,
} from "./claude-accounts.js";

type IdentityVerdict = "store-first" | "same" | "changed" | "ignore";

const WATCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Compare the stored Default identity with a fresh read.
 *
 * @remarks A logged out or failed read is `ignore` so a CLI hiccup never marks a session stale.
 * Only the email and the organisation id count as a change, and a read with no organisation id
 * compares the email alone, so a CLI answer that omits the field is not a change.
 */
export function compareIdentity(
  stored: DefaultIdentity | undefined,
  read: ClaudeIdentity,
): IdentityVerdict {
  if (!read.loggedIn || read.email === "") return "ignore";
  if (stored === undefined) return "store-first";
  const orgChanged = read.orgId !== "" && stored.orgId !== read.orgId;
  return stored.email === read.email && !orgChanged ? "same" : "changed";
}

let chain: Promise<void> = Promise.resolve();

async function runCheck(): Promise<void> {
  const read = await readClaudeIdentity();
  const stored = await readDefaultIdentity();
  const verdict = compareIdentity(stored, read);
  if (verdict === "same" || verdict === "ignore") return;
  await writeDefaultIdentity({
    email: read.email,
    orgId: read.orgId || (stored?.orgId ?? ""),
  });
  if (stored === undefined) return;
  for (const { card, session } of store.sessionsWithTmux()) {
    if (
      (session.claudeAccountId ?? DEFAULT_CLAUDE_ACCOUNT_ID) !==
      DEFAULT_CLAUDE_ACCOUNT_ID
    ) {
      continue;
    }
    await store.markAccountStale(card.id, session.id);
  }
  await store.recordAccountEvent(
    "account_login_changed",
    stored.email === read.email
      ? `Home Claude login ${read.email} changed organization`
      : `Home Claude login changed from ${stored.email} to ${read.email}`,
  );
  cacheHomeIdentity(read);
}

/**
 * Read the home login fresh and act on a change of its email or organisation.
 *
 * @remarks Checks run one at a time so two overlapping triggers cannot emit the event twice. A
 * failure is logged and never escapes, so a timer or listener cannot crash the server.
 */
export function checkDefaultIdentity(): Promise<void> {
  const next = chain.then(runCheck).catch((err: unknown) => {
    console.warn(
      `[identity-watch] check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  chain = next;
  return next;
}

/**
 * Check the home login on a timer and return the stop function.
 */
export function startDefaultIdentityWatch(
  intervalMs = WATCH_INTERVAL_MS,
): () => void {
  const timer = setInterval(() => {
    void checkDefaultIdentity();
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
