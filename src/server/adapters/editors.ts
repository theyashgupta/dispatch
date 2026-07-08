import { resolveBinaryPath } from "./resolveBinary.js";
import { run } from "./exec.js";

/** Absolute editor paths, resolved once at boot. null when the binary is not on PATH. Module-private
 * — only booleans and the spawn side-effect ever leave this module (T-06-03 information disclosure). */
let paths: { code: string | null; cursor: string | null } = {
  code: null,
  cursor: null,
};

/**
 * Resolve the absolute paths of `code` and `cursor` once at boot, store them module-private, and
 * return ONLY the availability booleans (path != null) for the board snapshot. Never rejects
 * (resolveBinaryPath swallows errors and yields null).
 */
export async function resolveEditors(): Promise<{
  code: boolean;
  cursor: boolean;
}> {
  const [code, cursor] = await Promise.all([
    resolveBinaryPath("code"),
    resolveBinaryPath("cursor"),
  ]);
  paths = { code, cursor };
  return { code: code != null, cursor: cursor != null };
}

/** The absolute path for `editor`, or null if unavailable. Used by the route to validate before
 * launch. Absolute paths stay inside this module — callers use it only for a null-check. */
export function editorPath(editor: "code" | "cursor"): string | null {
  return paths[editor];
}

/**
 * Open `workspacePath` in `editor` via the argv-array subprocess chokepoint. `workspacePath` is a
 * SINGLE argv element — never interpolated, never a shell string (T-06-01). Throws if the editor is
 * unavailable. `code`/`cursor` hand off to the GUI and exit fast, so run() resolves quickly — do NOT
 * hand-spawn a detached process (RESEARCH Pitfall 3).
 *
 * Self-healing on failure: the boot-resolved path can go stale after boot (Homebrew upgrades relink
 * paths; the editor may be moved or uninstalled). On a failed spawn we log server-side, re-resolve
 * the binary ONCE, refresh the module cache (so editorPath() and future requests see reality — a
 * gone editor now 400s instead of silently doing nothing), and retry a single time with the fresh
 * path. If the retry fails too (or the binary is gone) the error is rethrown to the caller's
 * fire-and-forget .catch, which logs it (T-06-04).
 */
export async function launchEditor(
  editor: "code" | "cursor",
  workspacePath: string,
): Promise<void> {
  const bin = paths[editor];
  if (bin == null) {
    throw new Error(`editor "${editor}" is not available on this machine`);
  }
  try {
    await run(bin, [workspacePath]);
  } catch (err) {
    console.error(
      `[editors] "${editor}" launch failed with boot-resolved path; re-resolving and retrying once:`,
      err,
    );
    const fresh = await resolveBinaryPath(editor);
    paths[editor] = fresh;
    if (fresh == null) throw err;
    await run(fresh, [workspacePath]);
  }
}
