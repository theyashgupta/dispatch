import type { SessionMeters } from "../../../shared/types.js";

const ROW_ONE =
  /^\s*([^│·\s](?:[^│·]*[^│·\s])?)(?:\s+·[^│]*|\s*)│\s+[█░]{10}\s+(?:(\d{1,3})%\s+[^\s/]+\/\S+|warming up)\s*$/;

function segmentNumber(segments: string[], pattern: RegExp): number | null {
  for (const segment of segments) {
    const match = pattern.exec(segment);
    if (match) {
      const value = Number(match[1]);
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

/**
 * Parse the two-row Claude status line from a captured pane into session meters.
 *
 * @remarks Scans from the bottom so a status-like row quoted in the transcript above the live
 * footer never wins. Returns null when no row 1 matches the full shape.
 */
export function parseStatusLine(pane: string): SessionMeters | null {
  const lines = pane.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const match = ROW_ONE.exec(lines[i]);
    if (!match) continue;
    const segments = (lines[i + 1] ?? "").split("│").map((s) => s.trim());
    return {
      contextPercent:
        match[2] === undefined ? null : Math.min(100, Number(match[2])),
      model: match[1].trim(),
      cost: segmentNumber(segments, /^\$(\d{1,9}(?:\.\d{1,6})?)$/),
      usage: {
        fiveHourPercent: segmentNumber(segments, /^5h (\d{1,3})%$/),
        sevenDayPercent: segmentNumber(segments, /^7d (\d{1,3})%$/),
      },
    };
  }
  return null;
}
