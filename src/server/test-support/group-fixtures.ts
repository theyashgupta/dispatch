import assert from "node:assert/strict";
import type { Card } from "../../shared/types.js";
import type { store as StoreType } from "../store/board.store.js";

let n = 0;

/**
 * Mint two local tickets, group them, and complete a start with a fake session so a test has a
 * group card in `in_progress` whose members mirror it. `workspacePath` defaults to a path that
 * does not exist, which every teardown helper treats as already clean.
 */
export async function startedGroup(
  store: typeof StoreType,
  opts: {
    workspacePath?: string;
    repos?: { path: string; base: string }[];
  } = {},
): Promise<{ g: Card; a: Card; b: Card }> {
  await store.load();
  n += 1;
  const a = await store.createLocalCard(`member a ${n}`, "");
  const b = await store.createLocalCard(`member b ${n}`, "");
  const minted = await store.createGroupCard(`group ${n}`, [a.id, b.id]);
  assert.equal(minted.ok, true);
  if (!minted.ok) throw new Error("unreachable");
  const g = minted.card;
  if (opts.repos) {
    await store.setCardWorkspace(g.id, {
      folder: opts.workspacePath ?? `/tmp/ws-${g.id}`,
      repos: opts.repos,
    });
  }
  await store.completeStart(g.id, undefined, {
    workspacePath: opts.workspacePath ?? `/tmp/ws-${g.id}`,
    tmuxSession: `dsp-${g.id}`,
    branch: g.id,
  });
  const live = store.getCard(g.id)!;
  assert.equal(live.column, "in_progress");
  return { g: live, a, b };
}
