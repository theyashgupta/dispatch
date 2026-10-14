import type { SystemMemory } from "../../shared/types.js";
import { http } from "@/lib/http";

/** Read the memory reading: GET /api/system/memory. */
export async function getSystemMemory(): Promise<SystemMemory> {
  const result = await http<SystemMemory>("/api/system/memory");
  if (!result.ok) throw new Error(`getSystemMemory failed: ${result.status}`);
  return result.data;
}
