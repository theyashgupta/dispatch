/**
 * Format a KB count as "N KB", "N.N MB" or "N.N GB"; null reads "size unknown".
 *
 * @remarks The MB branch stops at 1023.95 MB, where one-decimal rounding would print "1024.0 MB".
 */
export function formatSize(kb: number | null): string {
  if (kb === null) return "size unknown";
  if (kb < 1024) return `${kb} KB`;
  const mb = kb / 1024;
  if (mb < 1023.95) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
