import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config, ItemSourceConfig } from "../../shared/types.js";
import {
  buildRegistry,
  enabledSources,
  getSource,
  isSourceEnabled,
  setCredentialResolver,
} from "./registry.js";

function config(sentry?: ItemSourceConfig): Config {
  return {
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, ...(sentry ? { sentry } : {}) },
  };
}

test("Sentry is registered but disabled without an enabled flag", () => {
  buildRegistry(config());
  assert.equal(getSource("sentry")?.kind, "snapshot");
  assert.deepEqual(getSource("sentry")?.vaultKeys, ["SENTRY_TOKEN"]);
  assert.equal(isSourceEnabled("sentry"), false);
});

test("Sentry stays disabled when enabled is false", () => {
  buildRegistry(config({ enabled: false }));
  assert.equal(isSourceEnabled("sentry"), false);
});

test("Sentry is enabled only when enabled is exactly true", () => {
  buildRegistry(config({ enabled: true }));
  assert.equal(isSourceEnabled("sentry"), true);
  assert.deepEqual(
    enabledSources().map((s) => s.id),
    ["sentry"],
  );
});

test("a non-boolean enabled never enables Sentry", () => {
  for (const value of ["true", 1, {}]) {
    buildRegistry(config({ enabled: value as unknown as boolean }));
    assert.equal(isSourceEnabled("sentry"), false);
  }
});

test("the Sentry source reads its credential through the registered resolver", async () => {
  let calls = 0;
  setCredentialResolver("sentry", () => {
    calls += 1;
    return Promise.resolve(null);
  });
  buildRegistry(config({ enabled: true }));
  await assert.rejects(getSource("sentry")!.fetch(), /no Sentry credential/);
  assert.equal(calls, 1);
});
