/**
 * Whether a URL is a Linear-hosted upload asset — the single allowlist test shared by the
 * server's SSRF-safe proxy gate and the client's inline-vs-link render decision. Exact hostname
 * equality only (never a substring or suffix test), and https-only.
 */
export function isLinearUploadUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname === "uploads.linear.app";
}
