import { execFile } from "node:child_process";

/** Thrown by startup preflight steps (binary check, config load) to fail fast with a clear message. */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupError";
  }
}

/** The four binaries Dispatch needs at runtime (spec + BOARD-05). */
const REQUIRED_BINARIES = ["tmux", "ttyd", "claude", "git"] as const;

/** Per-binary install guidance surfaced when a binary is missing. */
const INSTALL_HINTS: Record<string, string> = {
  tmux: "brew install tmux",
  ttyd: "brew install ttyd",
  claude: "install Claude Code — https://docs.claude.com/claude-code",
  git: "xcode-select --install  (or: brew install git)",
};

/** Resolve true if `bin` is found on PATH, false otherwise. Never rejects. */
function isPresent(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile("which", [bin], (err) => resolve(!err));
  });
}

/**
 * Verify all four required binaries are on PATH.
 * Probes every binary (no short-circuit), then throws a single StartupError
 * naming EACH missing binary with install guidance. Resolves silently when all present.
 * @remarks BOARD-05: the startup preflight runs before the HTTP server listens and fails fast with
 * the COMPLETE missing list so the user fixes everything in one pass; the backend never serves a
 * degraded state.
 * @see docs/ARCHITECTURE.md#startup-preflight
 */
export async function checkBinaries(): Promise<void> {
  const results = await Promise.all(
    REQUIRED_BINARIES.map(async (bin) => [bin, await isPresent(bin)] as const),
  );
  const missing = results.filter(([, ok]) => !ok).map(([bin]) => bin);

  if (missing.length > 0) {
    const lines = missing.map(
      (bin) =>
        `  - ${bin}: ${INSTALL_HINTS[bin] ?? "install it and ensure it is on your PATH"}`,
    );
    throw new StartupError(
      `Missing required tools: ${missing.join(", ")}.\n` +
        `Dispatch needs all of tmux, ttyd, claude, git on PATH.\n` +
        `${lines.join("\n")}\n` +
        `Install the missing tool(s) and restart.`,
    );
  }
}
