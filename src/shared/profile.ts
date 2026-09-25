import type { UserProfile } from "./types.js";

export const PROFILE_TEXT_MAX = 200;
export const PROFILE_BRIEF_MAX = 4000;
export const PROFILE_HANDLES_MAX = 20;
export const PROFILE_HANDLE_MAX = 100;

type ProfileResult =
  { ok: true; value: UserProfile } | { ok: false; error: string };

type TextField = "name" | "email" | "role" | "brief";

/**
 * Validate and normalize an untrusted About you profile.
 *
 * @remarks Strings are trimmed and a blank field is stored as absent; handles are trimmed,
 * blanks dropped and duplicates collapsed before the count limit applies. Unknown keys are
 * dropped, so the stored profile only ever holds the five known fields.
 */
export function parseProfile(input: unknown): ProfileResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "profile must be an object" };
  }
  const o = input as Record<string, unknown>;
  const value: UserProfile = {};

  const limits: [TextField, number][] = [
    ["name", PROFILE_TEXT_MAX],
    ["email", PROFILE_TEXT_MAX],
    ["role", PROFILE_TEXT_MAX],
    ["brief", PROFILE_BRIEF_MAX],
  ];
  for (const [key, max] of limits) {
    const raw = o[key];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string") {
      return { ok: false, error: `${key} must be text` };
    }
    const text = raw.trim();
    if (text.length > max) {
      return { ok: false, error: `${key} must be at most ${max} characters` };
    }
    if (text !== "") value[key] = text;
  }

  if (o.handles !== undefined && o.handles !== null) {
    if (!Array.isArray(o.handles)) {
      return { ok: false, error: "handles must be a list" };
    }
    const handles = new Set<string>();
    for (const raw of o.handles) {
      if (typeof raw !== "string") {
        return { ok: false, error: "each handle must be text" };
      }
      const handle = raw.trim();
      if (handle.length > PROFILE_HANDLE_MAX) {
        return {
          ok: false,
          error: `each handle must be at most ${PROFILE_HANDLE_MAX} characters`,
        };
      }
      if (handle !== "") handles.add(handle);
      if (handles.size > PROFILE_HANDLES_MAX) {
        return {
          ok: false,
          error: `at most ${PROFILE_HANDLES_MAX} handles`,
        };
      }
    }
    if (handles.size > 0) value.handles = [...handles];
  }

  return { ok: true, value };
}
