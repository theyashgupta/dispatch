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

function config(github?: ItemSourceConfig): Config {
  return {
    linearApiKey: "",
    sources: { linear: { apiKey: "" }, ...(github ? { github } : {}) },
  };
}

test("GitHub is registered but disabled without an enabled flag", () => {
  buildRegistry(config());
  assert.equal(getSource("github")?.kind, "snapshot");
  assert.deepEqual(getSource("github")?.vaultKeys, ["GITHUB_TOKEN"]);
  assert.equal(isSourceEnabled("github"), false);
});

test("GitHub stays disabled when enabled is false", () => {
  buildRegistry(config({ enabled: false }));
  assert.equal(isSourceEnabled("github"), false);
});

test("GitHub is enabled only when enabled is exactly true", () => {
  buildRegistry(config({ enabled: true }));
  assert.equal(isSourceEnabled("github"), true);
  assert.deepEqual(
    enabledSources().map((s) => s.id),
    ["github"],
  );
});

test("the GitHub interval falls back to the global value", () => {
  buildRegistry({ ...config({ enabled: true }), pollIntervalMs: 45_000 });
  assert.equal(getSource("github")?.pollIntervalMs, 45_000);
  buildRegistry(config({ enabled: true, pollIntervalMs: 90_000 }));
  assert.equal(getSource("github")?.pollIntervalMs, 90_000);
});

test("the source reads its credential through the registered resolver", async () => {
  let calls = 0;
  setCredentialResolver("github", () => {
    calls += 1;
    return Promise.resolve(null);
  });
  buildRegistry(config({ enabled: true }));
  await assert.rejects(getSource("github")!.fetch(), /no GitHub credential/);
  assert.equal(calls, 1);
});

test("a non-boolean enabled never enables GitHub", () => {
  for (const value of ["true", 1, {}]) {
    buildRegistry(config({ enabled: value as unknown as boolean }));
    assert.equal(isSourceEnabled("github"), false);
  }
});
