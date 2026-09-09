const MD_EXT = /\.(md|markdown)$/i;

/**
 * Plain-text markdown path tokens as Claude Code prints them: `report.md`, `docs/report.md`,
 * `./a/b.markdown`, `/abs/path/x.md`.
 *
 * @remarks The lookbehind keeps a path inside a URL (`https://host/x.md`) from matching, so the
 * http link provider keeps owning URLs. The lookahead rejects `.mdx` and `x.md.bak` but accepts a
 * sentence-ending period after the extension.
 */
const MD_PATH_RE =
  /(?<![\w./~-])(?:\.{1,2}\/|\/)?(?:[\w.~-]+\/)*[\w-][\w.-]*\.(?:md|markdown)(?!\.?[\w-])/gi;

/**
 * Extracts the decoded filesystem path from a `file:` URI when it targets a markdown file.
 *
 * @remarks Shape derived from a live capture of Claude Code's OSC-8 output: file:///abs/path with
 * empty authority, percent-encoded spaces, no line or column suffix. URL.pathname excludes params
 * and fragments, so the extension test runs on the pure decoded path; the host is ignored because
 * the viewer API's realpath containment is the actual boundary.
 */
export function markdownFilePath(uri: string): string | null {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return null;
  }
  if (url.protocol !== "file:") return null;
  const path = decodeURIComponent(url.pathname);
  return MD_EXT.test(path) ? path : null;
}

/**
 * Viewer page URL for an absolute markdown path.
 */
export function viewerUrl(origin: string, mdPath: string): string {
  return `${origin}/viewer/?path=${encodeURIComponent(mdPath)}`;
}

/**
 * Every plain-text markdown path in one terminal line, with its start offset in the string.
 */
export function findMarkdownPaths(
  text: string,
): { text: string; index: number }[] {
  return Array.from(text.matchAll(MD_PATH_RE), (m) => ({
    text: m[0],
    index: m.index,
  }));
}
