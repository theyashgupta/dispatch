import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-onboarding-"));
process.env.HOME = home;
const { CONFIG_PATH } = await import("../services/infra/paths.js");
assert.ok(CONFIG_PATH.startsWith(home), "CONFIG_PATH escaped the temp HOME");
fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
const { loadConfig } = await import("./config.js");
const write = (extra: Record<string, unknown>) =>
  fs.writeFileSync(
    CONFIG_PATH,
    JSON.stringify(
      { port: 4799, workspaceRoot: path.join(home, "w"), ...extra },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );

after(() => fs.rmSync(home, { recursive: true, force: true }));

test("onboardingDone loads only when it is exactly true", () => {
  write({ onboardingDone: true });
  assert.equal(loadConfig().onboardingDone, true);
  for (const value of ["true", 1, false, null]) {
    write({ onboardingDone: value });
    assert.equal(loadConfig().onboardingDone, undefined, String(value));
  }
  write({});
  assert.equal(loadConfig().onboardingDone, undefined);
});
