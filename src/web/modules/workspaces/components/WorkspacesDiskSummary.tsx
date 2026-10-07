import { formatSize } from "../../../../shared/format-size.js";

interface WorkspacesDiskSummaryProps {
  totalKb: number;
  unknownSizes: number;
}

export function WorkspacesDiskSummary({
  totalKb,
  unknownSizes,
}: WorkspacesDiskSummaryProps) {
  return (
    <span className="text-sm whitespace-nowrap text-muted-foreground">
      {`${formatSize(totalKb)} on disk`}
      {unknownSizes > 0 ? ` (${unknownSizes} unknown)` : ""}
    </span>
  );
}
