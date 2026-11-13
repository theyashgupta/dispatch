import assert from "node:assert/strict";
import fs from "node:fs";
import { after, test } from "node:test";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  DEFAULT_USAGE_THRESHOLDS,
  USAGE_THRESHOLDS_ERRORS,
} from "../../shared/usage-thresholds.js";

const env = isolateEnv();
const { CONFIG_PATH } = await import("../services/infra/paths.js");
const express = (await import("express")).default;
const { boardRouter } = await import("./board.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });

const app = express();
app.use("/api", express.json(), boardRouter, httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/config/usage-thresholds`;
after(() => {
  server.close();
  env.cleanup();
});

const put = (body: unknown) =>
  fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const configValue = () =>
  (JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>)
    .usageThresholds;

const custom = {
  warningPercent: 60,
  criticalPercent: 80,
  limitPercent: { session: 100, weekly_all: 85, weekly_scoped: 90 },
};

void test("GET answers the defaults when nothing is stored", async () => {
  const res = await fetch(url);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), DEFAULT_USAGE_THRESHOLDS);
});

void test("PUT valid thresholds answers 200, GET reads them back and config.json holds them", async () => {
  const res = await put(custom);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), custom);
  assert.deepEqual(await (await fetch(url)).json(), custom);
  assert.deepEqual(configValue(), custom);
});

void test("PUT with a refused body answers 400 with the rule message and changes nothing", async () => {
  const before = fs.readFileSync(CONFIG_PATH, "utf8");
  const limits = custom.limitPercent;
  const cases: [string, unknown, string][] = [
    [
      "out of range",
      { ...custom, warningPercent: 0 },
      USAGE_THRESHOLDS_ERRORS.range,
    ],
    [
      "above 100",
      { ...custom, limitPercent: { ...limits, session: 101 } },
      USAGE_THRESHOLDS_ERRORS.range,
    ],
    [
      "non-integer",
      { ...custom, criticalPercent: 80.5 },
      USAGE_THRESHOLDS_ERRORS.range,
    ],
    [
      "warning equal to critical",
      { ...custom, warningPercent: 80 },
      USAGE_THRESHOLDS_ERRORS.order,
    ],
    [
      "warning above critical",
      { ...custom, warningPercent: 85 },
      USAGE_THRESHOLDS_ERRORS.order,
    ],
    [
      "critical above a limit",
      { ...custom, limitPercent: { ...limits, weekly_all: 75 } },
      USAGE_THRESHOLDS_ERRORS.limit,
    ],
    [
      "missing limit key",
      { ...custom, limitPercent: { session: 100, weekly_all: 90 } },
      USAGE_THRESHOLDS_ERRORS.range,
    ],
    [
      "missing limitPercent",
      { warningPercent: 60, criticalPercent: 80 },
      USAGE_THRESHOLDS_ERRORS.range,
    ],
  ];
  for (const [name, body, error] of cases) {
    const res = await put(body);
    assert.equal(res.status, 400, name);
    assert.deepEqual(await res.json(), { error }, name);
  }
  assert.equal(
    (
      (await (await put({ ...custom, warningPercent: 90 })).json()) as {
        error: string;
      }
    ).error,
    "Warning must be below critical.",
  );
  assert.equal(fs.readFileSync(CONFIG_PATH, "utf8"), before);
  assert.deepEqual(await (await fetch(url)).json(), custom);
});
