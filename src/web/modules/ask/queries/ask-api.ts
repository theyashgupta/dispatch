import type { AskTurn } from "../../../../shared/types.js";
import { http } from "@/lib/http";

export type AskResult =
  | { ok: true; answer: string }
  | { ok: false; error: "busy" | "timeout" | "failed" | "invalid" };

/**
 * Ask Claude a question about the board; an abort rejects with the fetch AbortError.
 */
export async function askQuestion(
  question: string,
  history: AskTurn[],
  signal: AbortSignal,
): Promise<AskResult> {
  const result = await http<{ answer: string }>("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, history }),
    signal,
  });
  if (result.ok) {
    return { ok: true, answer: result.data.answer };
  }
  if (result.status === 409) return { ok: false, error: "busy" };
  if (result.status === 504) return { ok: false, error: "timeout" };
  if (result.status === 400) return { ok: false, error: "invalid" };
  return { ok: false, error: "failed" };
}
