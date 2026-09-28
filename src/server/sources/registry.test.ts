import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "../../shared/types.js";
import {
  buildRegistry,
  enabledSources,
  getLinearSource,
  getSource,
  isSourceEnabled,
  listSources,
} from "./registry.js";

function config(extra: Partial<Config> = {}): Config {
  return { linearApiKey: "k", sources: { linear: { apiKey: "k" } }, ...extra };
}

test("a key with no enabled field yields one enabled snapshot source at 60000", () => {
  buildRegistry(config());
  const [linear] = enabledSources();
  assert.equal(linear?.id, "linear");
  assert.equal(linear?.kind, "snapshot");
  assert.equal(linear?.pollIntervalMs, 60_000);
  assert.deepEqual(linear?.vaultKeys, []);
  assert.equal(isSourceEnabled("linear"), true);
});

test("the source block interval wins over the global one", () => {
  buildRegistry(
    config({
      pollIntervalMs: 20_000,
      sources: { linear: { apiKey: "k", pollIntervalMs: 15_000 } },
    }),
  );
  assert.equal(getSource("linear")?.pollIntervalMs, 15_000);
});

test("the global interval applies when the source block has none", () => {
  buildRegistry(config({ pollIntervalMs: 20_000 }));
  assert.equal(getSource("linear")?.pollIntervalMs, 20_000);
});

test("an empty key builds the object but enables nothing", () => {
  buildRegistry(
    config({ linearApiKey: "", sources: { linear: { apiKey: "" } } }),
  );
  assert.equal(getLinearSource().id, "linear");
  assert.deepEqual(
    listSources().map((s) => s.id),
    ["linear", "github", "sentry", "slack", "calendar"],
  );
  assert.deepEqual(enabledSources(), []);
  assert.equal(isSourceEnabled("linear"), false);
});

test("enabled false with a key enables nothing", () => {
  buildRegistry(
    config({ sources: { linear: { apiKey: "k", enabled: false } } }),
  );
  assert.deepEqual(enabledSources(), []);
});

test("rebuilding clears the previous enabled set", () => {
  buildRegistry(config());
  buildRegistry(
    config({ linearApiKey: "", sources: { linear: { apiKey: "" } } }),
  );
  assert.deepEqual(enabledSources(), []);
  assert.equal(getSource("nope"), undefined);
});

test("enabled true without a key still enables nothing", () => {
  buildRegistry(
    config({
      linearApiKey: "",
      sources: { linear: { apiKey: "", enabled: true } },
    }),
  );
  assert.deepEqual(enabledSources(), []);
});

test("enabled true with a key enables the source", () => {
  buildRegistry(
    config({ sources: { linear: { apiKey: "k", enabled: true } } }),
  );
  assert.equal(isSourceEnabled("linear"), true);
});

test("a config with no sources block still builds Linear from the flat key", () => {
  buildRegistry({ linearApiKey: "k", pollIntervalMs: 25_000 });
  assert.equal(getSource("linear")?.pollIntervalMs, 25_000);
  assert.equal(isSourceEnabled("linear"), true);
});

test("the calendar source is built always and enabled only by enabled true", () => {
  buildRegistry(config());
  const calendar = getSource("calendar");
  assert.equal(calendar?.kind, "snapshot");
  assert.equal(calendar?.pollIntervalMs, 300_000);
  assert.deepEqual(calendar?.vaultKeys, ["CALENDAR_ICAL_URL"]);
  assert.equal(isSourceEnabled("calendar"), false);
  for (const enabledValue of [undefined, false]) {
    buildRegistry(
      config({
        sources: {
          linear: { apiKey: "k" },
          calendar: {
            mode: "macos",
            ...(enabledValue !== undefined ? { enabled: enabledValue } : {}),
          },
        },
      }),
    );
    assert.equal(isSourceEnabled("calendar"), false);
  }
  buildRegistry(
    config({
      sources: {
        linear: { apiKey: "k" },
        calendar: { enabled: true, mode: "ical", pollIntervalMs: 90_000 },
      },
    }),
  );
  assert.equal(isSourceEnabled("calendar"), true);
  assert.equal(getSource("calendar")?.pollIntervalMs, 90_000);
  assert.deepEqual(
    enabledSources().map((s) => s.id),
    ["linear", "calendar"],
  );
});
