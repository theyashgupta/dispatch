import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFakeSource } from "../test-support/fake-source.js";
import { sourceState, vaultKeyUsers } from "./source-gateway.js";
import { buildRegistry } from "../sources/registry.js";

test("vaultKeyUsers names every source that declares the key and nobody else", () => {
  const slack = makeFakeSource({ id: "slack", vaultKeys: ["SLACK_TOKEN"] });
  const meet = makeFakeSource({
    id: "meeting",
    vaultKeys: ["SLACK_TOKEN", "GRANOLA_KEY"],
  });
  const linear = makeFakeSource({ id: "linear" });
  const sources = [linear, slack, meet];
  assert.deepEqual(vaultKeyUsers("SLACK_TOKEN", sources), ["slack", "meeting"]);
  assert.deepEqual(vaultKeyUsers("GRANOLA_KEY", sources), ["meeting"]);
  assert.deepEqual(vaultKeyUsers("OTHER", sources), []);
});

test("the registry's Linear source declares no vault key", () => {
  buildRegistry({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  assert.deepEqual(vaultKeyUsers("LINEAR_API_KEY"), []);
});

test("sourceState distinguishes enabled, disabled and unknown", () => {
  buildRegistry({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });
  assert.equal(sourceState("linear"), "enabled");
  buildRegistry({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k", enabled: false } },
  });
  assert.equal(sourceState("linear"), "disabled");
  assert.equal(sourceState("slack"), "unknown");
});
