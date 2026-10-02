import type {
  Playbook,
  PlaybookPickerResponse,
} from "../../../../shared/types.js";
import { http, httpError, type ApiResult } from "@/lib/http";

/**
 * List playbooks: GET /api/playbooks.
 *
 * @remarks
 * Read fresh on every call so the list reflects the on-disk markdown without a cache, and it
 * throws on any non-2xx so the caller can surface a load failure.
 */
export async function getPlaybooks(): Promise<Playbook[]> {
  const result = await http<{ playbooks: Playbook[] }>("/api/playbooks");
  if (!result.ok) {
    throw httpError("getPlaybooks", result);
  }
  return result.data.playbooks;
}

/**
 * Fetch the data source of the StartModal picker: GET /api/playbooks/picker.
 *
 * @remarks
 * Read fresh on every modal open so malformed rows and the remembered default reflect the current
 * on-disk state. Throws on any non-2xx.
 */
export async function getPickerPlaybooks(): Promise<PlaybookPickerResponse> {
  const result = await http<PlaybookPickerResponse>("/api/playbooks/picker");
  if (!result.ok) {
    throw httpError("getPickerPlaybooks", result);
  }
  return result.data;
}

export type PlaybookWriteResult =
  | { ok: true; playbook: Playbook }
  | { ok: false; error: "name-exists" | "footgun" | "generic" };

export interface PlaybookWriteInput {
  name: string;
  body: string;
}

/**
 * Map a create or update response to a write result.
 *
 * @remarks
 * A 409 becomes `name-exists` and a `{error:"footgun"}` body becomes `footgun`. Every other
 * failure collapses to `generic`.
 */
function toWriteResult(
  result: ApiResult<{ playbook: Playbook }>,
): PlaybookWriteResult {
  if (result.ok) {
    return { ok: true, playbook: result.data.playbook };
  }
  if (result.status === 409) {
    return { ok: false, error: "name-exists" };
  }
  return {
    ok: false,
    error: result.error === "footgun" ? "footgun" : "generic",
  };
}

/**
 * Create a playbook: POST /api/playbooks.
 *
 * @remarks
 * A 409 becomes `name-exists` and a 400 with a `{error:"footgun"}` body becomes `footgun`, the two
 * rejections the editor renders inline. Every other failure collapses to `generic`.
 */
export async function createPlaybook(
  input: PlaybookWriteInput,
): Promise<PlaybookWriteResult> {
  return toWriteResult(
    await http<{ playbook: Playbook }>("/api/playbooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

/**
 * Rename or edit a playbook: PUT /api/playbooks/:slug.
 *
 * @remarks
 * Discriminates like `createPlaybook`, and a 404 (playbook deleted under the open editor) also
 * collapses to `generic`, since the editor has one shared failure notice beyond the two named
 * rejections.
 */
export async function updatePlaybook(
  slug: string,
  input: PlaybookWriteInput,
): Promise<PlaybookWriteResult> {
  return toWriteResult(
    await http<{ playbook: Playbook }>(
      `/api/playbooks/${encodeURIComponent(slug)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    ),
  );
}

/**
 * Delete a playbook: DELETE /api/playbooks/:slug.
 *
 * @remarks
 * Resolves a bare `{ ok }`, because the confirm modal reads a 404 the same as any other failure.
 */
export async function deletePlaybook(slug: string): Promise<{ ok: boolean }> {
  const result = await http(`/api/playbooks/${encodeURIComponent(slug)}`, {
    method: "DELETE",
  });
  return { ok: result.ok };
}

/**
 * Generate a playbook draft via headless `claude -p`: POST /api/playbooks/generate.
 *
 * @remarks
 * The server owns the ~150s generation bound and always answers within it, so there is no client
 * abort timer. Every failure reads the same to the user, so this resolves a plain `{ ok, draft? }`
 * instead of fanning out error codes.
 */
export async function generatePlaybookDraft(input: {
  direction: string;
  sourcePaths: string[];
}): Promise<{ ok: true; draft: string } | { ok: false }> {
  try {
    const result = await http<{ draft: string }>("/api/playbooks/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!result.ok) {
      return { ok: false };
    }
    return { ok: true, draft: result.data.draft };
  } catch {
    return { ok: false };
  }
}
