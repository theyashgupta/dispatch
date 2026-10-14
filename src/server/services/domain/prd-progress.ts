import type { LoopProgress } from "../../../shared/types.js";
import { loopFilePath } from "./loop-progress.js";

const PLANNING = ".planning/";
const PLANNING_AT = /(^|\/)\.planning\//;
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function validSlug(value: string): string | null {
  return SLUG.test(value) ? value : null;
}

/**
 * Reads the PRD path and the loop slug from the text of a ralph loop engine file.
 *
 * @remarks The slug comes from the `completion_promise` front matter line and is refused when it could escape a folder. The lookbehind keeps the trailing punctuation strip linear on a long run of dots.
 */
export function parsePrdEngine(text: string): {
  prdPath: string | null;
  slug: string | null;
} {
  const prdPath = (
    /Execute the PRD at [`"'(]?([^\s`"')]+)/.exec(text)?.[1] ?? ""
  ).replace(/(?<![.,;:])[.,;:]+$/, "");
  const promise =
    /^completion_promise:\s*["']?RALPH COMPLETE (\S+?)["']?[ \t]*\r?$/m.exec(
      text,
    );
  return {
    prdPath: prdPath === "" ? null : prdPath,
    slug: promise?.[1] === undefined ? null : validSlug(promise[1]),
  };
}

/**
 * Returns the file name of a PRD path without `.md`, or null when it is not a valid slug.
 */
export function prdSlugOf(prdPath: string): string | null {
  const name = prdPath.slice(prdPath.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return validSlug(name);
}

/**
 * Returns the relative folder that holds the state and attempts files of a single PRD loop, or null when the PRD path has no `.planning/` folder.
 */
export function featureDir(prdPath: string, slug: string): string | null {
  const found = PLANNING_AT.exec(prdPath);
  if (found === null) return null;
  const at = found.index + (found[1] ?? "").length;
  return `${prdPath.slice(0, at)}${PLANNING}${slug}`;
}

function insideDir(slug: string, prdFile: string | undefined): string | null {
  if (prdFile === undefined || prdFile.startsWith("/")) return null;
  if (prdFile.split("/").includes("..")) return null;
  return featureDir(prdFile, slug);
}

/**
 * Returns the root-relative resume file of a loop.
 *
 * @remarks A single PRD loop keeps it in its feature folder, or in `.planning/<slug>` when its PRD path is outside the root. A roadmap loop keeps it in the group folder.
 */
export function resumeFilePath(
  slug: string,
  prdFile?: string,
  single = prdFile !== undefined,
): string {
  const dir = insideDir(slug, prdFile) ?? (single ? `.planning/${slug}` : null);
  return dir === null ? loopFilePath(slug, "resume.md") : `${dir}/resume.md`;
}

/**
 * Returns the root-relative state file of a single PRD loop, or null when the PRD path is not a relative path inside the root with a `.planning/` folder.
 */
export function featureStateFile(slug: string, prdFile: string): string | null {
  const dir = insideDir(slug, prdFile);
  return dir === null ? null : `${dir}/state.md`;
}

/**
 * Tells whether a stored loop model is a single PRD model rather than a roadmap ledger model.
 *
 * @remarks Only the single PRD builder sets `prdFile` or leaves `roadmapFile` empty, and an outside-root PRD drops `prdFile`, so either mark decides it. The card source cannot: a launched ticket card can hold a roadmap ledger.
 */
export function isPrdModel(progress: LoopProgress | undefined): boolean {
  return (
    progress !== undefined &&
    (progress.prdFile !== undefined || progress.roadmapFile === "")
  );
}
