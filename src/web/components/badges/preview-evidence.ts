import type { PreviewEvidence, PreviewInfo } from "../../../shared/types.js";

/**
 * Evidence-bearing hover text for the preview badge's `title` attribute.
 * @remarks The aria-label deliberately stays evidence free so a screen reader announces the
 * action rather than a diagnostic paragraph; the title carries the evidence instead.
 */
export function previewBadgeTitle(preview: PreviewInfo): string {
  const { evidence, port } = preview;
  if (evidence == null) return `Open preview, localhost:${port}`;
  const base =
    evidence.source === "cwd"
      ? evidence.matchedCwd != null
        ? `Detected via cwd match (${evidence.matchedCwd}), pid ${evidence.pid}, bound ${evidence.bindAddress}`
        : `Detected via cwd match, pid ${evidence.pid}, bound ${evidence.bindAddress}`
      : `Detected via pane ancestry, pid ${evidence.pid}, bound ${evidence.bindAddress}`;
  return evidence.cwdMismatch === true
    ? `${base}; cwd points elsewhere, verify`
    : base;
}

/**
 * Evidence readout for the detail panel's preview row, one mono line.
 */
export function previewEvidenceLine(evidence: PreviewEvidence): string {
  return evidence.source === "cwd"
    ? evidence.matchedCwd != null
      ? `pid ${evidence.pid} · cwd ${evidence.matchedCwd} · ${evidence.bindAddress}`
      : `pid ${evidence.pid} · cwd match · ${evidence.bindAddress}`
    : `pid ${evidence.pid} · pane ancestry · ${evidence.bindAddress}`;
}
