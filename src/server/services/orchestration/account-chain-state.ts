import fsp from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import type {
  ChainAccountEntry,
  ChainMove,
  ChainStateFile,
} from "../../../shared/types.js";
import { CLAUDE_ACCOUNTS_DIR } from "../infra/paths.js";

export const CHAIN_STATE_PATH = path.join(
  CLAUDE_ACCOUNTS_DIR,
  "chain-state.json",
);

export const MAX_CHAIN_MOVES = 50;

const CHAIN_STATES = new Set([
  "available",
  "near-limit",
  "limited",
  "login-expired",
  "unknown",
]);

/**
 * Return a chain state with no accounts, no dwell start, no exhausted record and no moves.
 */
export function emptyChainState(): ChainStateFile {
  return { accounts: {}, inUseSince: null, exhausted: null, moves: [] };
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

const isTimeOrNull = (raw: unknown): boolean =>
  raw === null || typeof raw === "string";

/**
 * Keep the account entries with a known state, a bucket list and a string or null `limitedUntil`.
 */
function validAccounts(
  raw: Record<string, unknown>,
): ChainStateFile["accounts"] {
  const accounts: ChainStateFile["accounts"] = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (
      isRecord(entry) &&
      typeof entry.state === "string" &&
      CHAIN_STATES.has(entry.state) &&
      Array.isArray(entry.buckets) &&
      isTimeOrNull(entry.limitedUntil)
    ) {
      accounts[id] = entry as unknown as ChainAccountEntry;
    }
  }
  return accounts;
}

/**
 * Read `chain-state.json`, empty when the file is missing, unreadable or not the expected shape.
 *
 * @remarks The file is derived runtime state that the controller rebuilds from usage reads, so a
 * corrupt copy must never throw or stop the boot.
 */
export async function readChainState(): Promise<ChainStateFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fsp.readFile(CHAIN_STATE_PATH, "utf8"));
  } catch {
    return emptyChainState();
  }
  if (!isRecord(parsed) || !isRecord(parsed.accounts)) {
    return emptyChainState();
  }
  return {
    accounts: validAccounts(parsed.accounts),
    inUseSince:
      typeof parsed.inUseSince === "string" ? parsed.inUseSince : null,
    exhausted:
      isRecord(parsed.exhausted) &&
      typeof parsed.exhausted.since === "string" &&
      isTimeOrNull(parsed.exhausted.earliestResetAt)
        ? (parsed.exhausted as unknown as ChainStateFile["exhausted"])
        : null,
    moves: Array.isArray(parsed.moves)
      ? (parsed.moves as ChainMove[]).slice(-MAX_CHAIN_MOVES)
      : [],
  };
}

/**
 * Write `chain-state.json` atomically at mode 0600, keeping only the last 50 moves.
 */
export async function writeChainState(state: ChainStateFile): Promise<void> {
  await fsp.mkdir(CLAUDE_ACCOUNTS_DIR, { recursive: true, mode: 0o700 });
  await fsp.chmod(CLAUDE_ACCOUNTS_DIR, 0o700);
  const trimmed: ChainStateFile = {
    ...state,
    moves: state.moves.slice(-MAX_CHAIN_MOVES),
  };
  await writeFileAtomic(
    CHAIN_STATE_PATH,
    JSON.stringify(trimmed, null, 2) + "\n",
    { mode: 0o600 },
  );
  await fsp.chmod(CHAIN_STATE_PATH, 0o600);
}
