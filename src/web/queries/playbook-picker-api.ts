import type { PlaybookPickerResponse } from "../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Read the start dialogs' playbook picker data: GET /api/playbooks/picker.
 *
 * @remarks
 * Same request and result as the playbooks module's reader, because a module may not import another module. Throws on any non-2xx.
 */
export async function getPickerPlaybooks(): Promise<PlaybookPickerResponse> {
  const result = await http<PlaybookPickerResponse>("/api/playbooks/picker");
  if (!result.ok) {
    throw httpError("getPickerPlaybooks", result);
  }
  return result.data;
}
