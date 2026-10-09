import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { Card } from "../../../src/shared/types.js";
import type { OrchestrationEventRow, Sandbox } from "./sandbox.js";

/** Read a JSON-lines file into objects, or return an empty list when the file does not exist. */
export const readJsonl = (file: string): Record<string, unknown>[] =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    : [];

/** Fetch one card of the board from the board API, or undefined when the board has no such card. */
export async function cardOf(
  sb: Sandbox,
  board: string,
  id: string,
): Promise<Card | undefined> {
  const res = await sb.api<{ cards: Card[] }>(
    "GET",
    `/api/board?board=${board}`,
  );
  assert.equal(res.status, 200);
  return res.body.cards.find((c) => c.id === id);
}

/** Write every orchestration event of the board to the run log file, one line each. */
export async function writeRunLog(
  sb: Sandbox,
  board: string,
  file: string,
): Promise<OrchestrationEventRow[]> {
  const events = await sb.orchestrationEvents(board);
  const lines = events.map(
    (e) =>
      `${e.id}\t${e.ts}\t${e.kind}\t${e.cardId ?? "-"}\t${JSON.stringify(e.data)}`,
  );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  return events;
}
