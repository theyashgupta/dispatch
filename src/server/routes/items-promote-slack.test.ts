import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Card, Item } from "../../shared/types.js";
import { isolateEnv } from "../test-support/fixtures.js";

isolateEnv();
const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { itemsRouter } = await import("./items.route.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });
await store.load();

const app = express();
app.use("/api", express.json(), itemsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => server.close());

const permalink = "https://acme.slack.com/archives/C0G6ENG/p1790607974050980";
const mention: Item = {
  id: "slack:C0G6ENG:1790607974.050980",
  source: "slack",
  type: "mention",
  title: "ben in #eng-platform: should we ship the deploy plan today?",
  snippet: "@g6-tester should we ship the deploy plan today?",
  url: permalink,
  createdAt: "2026-09-28T09:00:00.000Z",
  priority: 75,
  state: "unread",
  meta: {
    channel: "C0G6ENG",
    channelName: "eng-platform",
    author: "ben",
    conversation: "channel",
  },
};
await store.upsertItems("slack", [mention], { kind: "append" });

test("promoting a Slack mention creates a card whose description holds the message, the channel and the permalink", async () => {
  const res = await fetch(
    `${base}/items/${encodeURIComponent(mention.id)}/promote`,
    { method: "POST" },
  );
  assert.equal(res.status, 201);
  const { card } = (await res.json()) as { card: Card };
  const stored = store.snapshot().cards.find((c) => c.id === card.id);
  const description = stored?.description ?? "";
  assert.ok(description.includes(mention.snippet), description);
  assert.ok(description.includes("channelName: eng-platform"), description);
  assert.ok(description.includes(permalink), description);
  assert.equal(stored?.issueId, mention.id);
});
