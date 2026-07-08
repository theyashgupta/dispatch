import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";

/** Bounded retries when a concurrent writer overwrites our entry between our write and re-read. */
const MAX_SEED_ATTEMPTS = 5;

/**
 * In-process serialization lock: chains every preSeedTrust body so two starts in this process
 * cannot read-modify-write `~/.claude.json` concurrently. Errors are swallowed into the chain so
 * one failed seed can never wedge the next (mirrors boardStore's mutation queue discipline).
 */
let seedQueue: Promise<unknown> = Promise.resolve();
function withSeedLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = seedQueue.then(fn, fn);
  seedQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** The probe-verified seed for a brand-new project entry (02-RESEARCH § seed shape). */
function freshSeed(): Record<string, unknown> {
  return {
    allowedTools: [],
    mcpContextUris: [],
    mcpServers: {},
    enabledMcpjsonServers: [],
    disabledMcpjsonServers: [],
    hasTrustDialogAccepted: true,
    projectOnboardingSeenCount: 1,
    hasClaudeMdExternalIncludesApproved: false,
    hasClaudeMdExternalIncludesWarningShown: false,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Pre-seed `hasTrustDialogAccepted: true` for `workspacePath` (exact absolute path, no
 * trailing slash) in `~/.claude.json`. Returns true only if the write is verified by re-read;
 * returns false (without writing) on any read/parse failure. Never throws.
 */
export function preSeedTrust(workspacePath: string): Promise<boolean> {
  const claudeJsonPath = path.join(os.homedir(), ".claude.json");

  return withSeedLock(async () => {
    for (let attempt = 1; attempt <= MAX_SEED_ATTEMPTS; attempt++) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(await fs.readFile(claudeJsonPath, "utf8"));
      } catch {
        return false;
      }
      if (!isPlainObject(parsed)) {
        return false;
      }

      const projects = isPlainObject(parsed.projects) ? parsed.projects : {};
      const existing = projects[workspacePath];
      const entry = isPlainObject(existing)
        ? { ...existing, hasTrustDialogAccepted: true }
        : freshSeed();
      const next = {
        ...parsed,
        projects: { ...projects, [workspacePath]: entry },
      };

      try {
        await writeFileAtomic(claudeJsonPath, JSON.stringify(next, null, 2), {
          mode: 0o600,
        });
      } catch {
        return false;
      }

      let verifyParsed: unknown;
      try {
        verifyParsed = JSON.parse(await fs.readFile(claudeJsonPath, "utf8"));
      } catch {
        return false;
      }
      if (isPlainObject(verifyParsed) && isPlainObject(verifyParsed.projects)) {
        const landed = verifyParsed.projects[workspacePath];
        if (isPlainObject(landed) && landed.hasTrustDialogAccepted === true) {
          return true;
        }
      }
    }
    return false;
  });
}
