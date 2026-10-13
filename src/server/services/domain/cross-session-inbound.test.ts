import test from "node:test";
import assert from "node:assert/strict";
import type { CrossSessionInbound } from "../../../shared/types.js";
import {
  isGuardedLaunch,
  resolveCrossSessionInbound,
} from "./cross-session-inbound.js";

const VALUES: CrossSessionInbound[] = ["accept", "hold", "refuse"];

type Row = Parameters<typeof resolveCrossSessionInbound>[0] & {
  expected: CrossSessionInbound;
};

const ROWS: Row[] = [
  {
    intent: "refuse",
    guarded: false,
    policy: null,
    config: "accept",
    expected: "refuse",
  },
  {
    intent: "hold",
    guarded: false,
    policy: "accept",
    config: "refuse",
    expected: "hold",
  },
  {
    intent: "accept",
    guarded: true,
    policy: "hold",
    config: "hold",
    expected: "accept",
  },
  {
    intent: "hold",
    guarded: true,
    policy: null,
    config: "accept",
    expected: "hold",
  },
  {
    intent: "accept",
    guarded: true,
    policy: "refuse",
    config: "hold",
    expected: "accept",
  },
  {
    intent: null,
    guarded: true,
    policy: "hold",
    config: "accept",
    expected: "hold",
  },
  {
    intent: undefined,
    guarded: true,
    policy: "accept",
    config: "refuse",
    expected: "accept",
  },
  {
    intent: undefined,
    guarded: true,
    policy: "refuse",
    config: "accept",
    expected: "refuse",
  },
  {
    intent: undefined,
    guarded: true,
    policy: null,
    config: "hold",
    expected: "refuse",
  },
  {
    intent: undefined,
    guarded: false,
    policy: "hold",
    config: "accept",
    expected: "accept",
  },
  {
    intent: null,
    guarded: false,
    policy: "refuse",
    config: "hold",
    expected: "hold",
  },
  {
    intent: undefined,
    guarded: false,
    policy: null,
    config: "refuse",
    expected: "refuse",
  },
];

void test("the resolver follows the intent, guarded policy, config order", () => {
  for (const { expected, ...args } of ROWS) {
    assert.equal(
      resolveCrossSessionInbound(args),
      expected,
      JSON.stringify(args),
    );
  }
});

void test("an intent or policy outside the known values counts as unset", () => {
  const bad = "../../x" as CrossSessionInbound;
  assert.equal(
    resolveCrossSessionInbound({
      intent: bad,
      guarded: false,
      policy: null,
      config: "hold",
    }),
    "hold",
  );
  assert.equal(
    resolveCrossSessionInbound({
      intent: null,
      guarded: true,
      policy: bad,
      config: "accept",
    }),
    "refuse",
  );
});

void test("a guarded launch never takes the config value when intent and policy are empty", () => {
  for (const config of VALUES) {
    assert.equal(
      resolveCrossSessionInbound({
        intent: undefined,
        guarded: true,
        policy: null,
        config,
      }),
      "refuse",
    );
  }
});

void test("an orchestrator card is guarded", () => {
  assert.equal(isGuardedLaunch({ source: "orchestrator" }), true);
});

void test("a Roadmap Loop playbook name is guarded in any case", () => {
  for (const playbook of [
    "Roadmap Loop (autonomous)",
    "roadmap loop",
    "  ROADMAP LOOP",
  ]) {
    assert.equal(
      isGuardedLaunch({ source: "group", startIntent: { playbook } }),
      true,
      playbook,
    );
  }
});

void test("other playbooks and cards without an intent are not guarded", () => {
  assert.equal(
    isGuardedLaunch({
      source: "group",
      startIntent: { playbook: "Roadmap + PRD + Ralph Loop" },
    }),
    false,
  );
  assert.equal(
    isGuardedLaunch({ source: "group", startIntent: { playbook: "Ship it" } }),
    false,
  );
  assert.equal(isGuardedLaunch({ source: "linear" }), false);
  assert.equal(isGuardedLaunch({ source: undefined, startIntent: {} }), false);
});
