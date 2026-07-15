import type { PrerequisiteStatus } from "../../shared/types.js";
import { resolveBinaryPath } from "../adapters/resolve-binary.js";

export type { PrerequisiteStatus };

/** The four binaries Dispatch needs at runtime (spec + BOARD-05). */
export const REQUIRED_BINARIES = ["tmux", "ttyd", "git", "claude"] as const;

/** Per-binary install guidance surfaced when a binary is missing. */
export const INSTALL_HINTS: Record<string, string> = {
  tmux: "brew install tmux",
  ttyd: "brew install ttyd",
  claude: "install Claude Code — https://docs.claude.com/claude-code",
  git: "xcode-select --install  (or: brew install git)",
};

/**
 * Probe every required binary on PATH and return a per-binary status.
 * @remarks BOARD-05: the boot preflight is now INFORMATIVE — the backend boots regardless so the
 * setup screen can render live status; sessions needing a missing binary still fail at use-time.
 * @see docs/ARCHITECTURE.md#startup-preflight
 */
export async function probePrerequisites(): Promise<PrerequisiteStatus[]> {
  return Promise.all(
    REQUIRED_BINARIES.map(async (name) => {
      const present = (await resolveBinaryPath(name)) != null;
      const hint = present ? null : (INSTALL_HINTS[name] ?? null);
      const installable = name !== "claude";
      return {
        name,
        present,
        hint,
        installable,
        command: present ? null : installable ? hint : null,
      };
    }),
  );
}
