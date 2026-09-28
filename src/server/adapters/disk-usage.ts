import { run } from "./exec.js";

/**
 * Measure the disk usage of `dirPath` in KB through `du -sk`, or null when du fails or times out.
 *
 * @remarks Never throws. du exits 1 but still prints a total when a subdirectory is unreadable or
 * files vanish mid-walk, so a numeric exit keeps the printed total.
 */
export async function diskUsageKb(dirPath: string): Promise<number | null> {
  try {
    const { stdout } = await run("du", ["-sk", dirPath], {
      timeout: 20_000,
      killEscalationMs: 2_000,
    });
    return parseKb(stdout);
  } catch (err) {
    const { code, stdout } = err as { code?: unknown; stdout?: string };
    return typeof code === "number" ? parseKb(stdout ?? "") : null;
  }
}

function parseKb(stdout: string): number | null {
  const kb = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "", 10);
  return Number.isFinite(kb) ? kb : null;
}
