import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import type { Board, Card, Config } from "../../../shared/types.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { DEFAULT_BOARD_KEY, defaultBoardPolicy, parseBoardKey } =
  await import("../../../shared/board-key.js");
const { setHooksRuntime, setOrchestrationConfig } =
  await import("../infra/config-holder.js");
const { hookSettingsPath } = await import("../infra/paths.js");
const { buildLaunch } = await import("./steps.js");

const ROADMAP = parseBoardKey("RMP");
assert.ok(ROADMAP);
const boards = new Map<string, Board>([
  [
    DEFAULT_BOARD_KEY,
    {
      key: DEFAULT_BOARD_KEY,
      policy: defaultBoardPolicy(DEFAULT_BOARD_KEY),
    } as Board,
  ],
  [
    ROADMAP,
    {
      key: ROADMAP,
      policy: { ...defaultBoardPolicy(ROADMAP), crossSessionInbound: "accept" },
    } as Board,
  ],
]);
const stored = new Map<string, Card>();
let boardReads = 0;

setBoardRepository(
  fakeBoardRepository({
    getBoard: (key) => {
      boardReads += 1;
      return boards.get(key);
    },
    getCard: (id) => stored.get(id),
  }),
);
after(() => {
  setBoardRepository(store);
  env.cleanup();
});

setHooksRuntime({ capable: true, port: 4711, statusChannel: "hooks" });

const ACCOUNT = { id: "default", label: "Default" } as never;
const HOOKS = { port: 4711, token: "tok", cardId: "C-1" };

const cardOf = (over: Partial<Card>) =>
  ({
    id: "C-1",
    identifier: "C-1",
    column: "todo",
    source: "linear",
    ...over,
  }) as Card;

async function settingsFor(card: Card, config?: Partial<Config>) {
  setOrchestrationConfig({ linearApiKey: "", ...config });
  const { argv } = await buildLaunch(ACCOUNT, [], HOOKS, card);
  return argv[argv.indexOf("--settings") + 1];
}

void test("a ticket card passes the accept settings file", async () => {
  assert.equal(await settingsFor(cardOf({})), hookSettingsPath("accept"));
});

void test("a Roadmap Loop card passes the refuse settings file", async () => {
  const card = cardOf({
    source: "group",
    startIntent: { playbook: "Roadmap Loop (autonomous)" },
  });
  assert.equal(await settingsFor(card), hookSettingsPath("refuse"));
});

void test("a launch intent replaces the stored card intent", async () => {
  const card = cardOf({});
  setOrchestrationConfig({ linearApiKey: "" });
  const settingsOf = async (launchIntent: NonNullable<Card["startIntent"]>) => {
    const { argv } = await buildLaunch(ACCOUNT, [], HOOKS, card, launchIntent);
    return argv[argv.indexOf("--settings") + 1];
  };
  assert.equal(
    await settingsOf({ playbook: "Roadmap Loop (autonomous)" }),
    hookSettingsPath("refuse"),
  );
  assert.equal(
    await settingsOf({ crossSessionInbound: "hold" }),
    hookSettingsPath("hold"),
  );
});

void test("an orchestrator card passes the refuse orchestrator settings file", async () => {
  const card = cardOf({ source: "orchestrator", ownerOrchestrator: "lead" });
  assert.equal(await settingsFor(card), hookSettingsPath("refuse", true));
});

void test("a start intent value picks its own settings file", async () => {
  const card = cardOf({ startIntent: { crossSessionInbound: "hold" } });
  assert.equal(await settingsFor(card), hookSettingsPath("hold"));
});

void test("a guarded card ignores a hold config value", async () => {
  const card = cardOf({
    source: "group",
    startIntent: { playbook: "Roadmap Loop" },
  });
  assert.equal(
    await settingsFor(card, { crossSessionInbound: "hold" }),
    hookSettingsPath("refuse"),
  );
});

void test("a ticket card follows the config value", async () => {
  assert.equal(
    await settingsFor(cardOf({}), { crossSessionInbound: "hold" }),
    hookSettingsPath("hold"),
  );
});

void test("a Roadmap Loop card follows the accept policy of its board", async () => {
  const card = cardOf({
    source: "group",
    boardKey: ROADMAP,
    startIntent: { playbook: "Roadmap Loop (autonomous)" },
  });
  assert.equal(await settingsFor(card), hookSettingsPath("accept"));
});

void test("an orchestrator card follows the accept policy of its board in the orchestrator settings file", async () => {
  const card = cardOf({
    source: "orchestrator",
    boardKey: ROADMAP,
    ownerOrchestrator: "lead",
  });
  assert.equal(await settingsFor(card), hookSettingsPath("accept", true));
});

void test("a ticket card ignores the board policy", async () => {
  const card = cardOf({ boardKey: ROADMAP });
  assert.equal(
    await settingsFor(card, { crossSessionInbound: "hold" }),
    hookSettingsPath("hold"),
  );
});

void test("a stale card copy launches with the start intent stored now", async () => {
  const fresh = cardOf({ startIntent: { crossSessionInbound: "hold" } });
  stored.set(fresh.id, fresh);
  try {
    assert.equal(await settingsFor(cardOf({})), hookSettingsPath("hold"));
  } finally {
    stored.clear();
  }
});

void test("a stored intent outside the known values counts as unset", async () => {
  const card = cardOf({
    startIntent: { crossSessionInbound: "../../x" as never },
  });
  assert.equal(await settingsFor(card), hookSettingsPath("accept"));
});

void test("a stored board policy outside the known values counts as unset in the orchestrator settings file", async () => {
  const key = parseBoardKey("BAD");
  assert.ok(key);
  boards.set(key, {
    key,
    policy: { ...defaultBoardPolicy(key), crossSessionInbound: "../../x" },
  } as unknown as Board);
  const card = cardOf({
    source: "orchestrator",
    boardKey: key,
    ownerOrchestrator: "lead",
  });
  assert.equal(await settingsFor(card), hookSettingsPath("refuse", true));
});

void test("a ticket card does not read the board", async () => {
  boardReads = 0;
  await settingsFor(cardOf({ boardKey: ROADMAP }));
  assert.equal(boardReads, 0);
});

void test("a launch without hooks passes no settings file", async () => {
  setOrchestrationConfig({ linearApiKey: "", crossSessionInbound: "hold" });
  const { argv } = await buildLaunch(ACCOUNT, [], null, cardOf({}));
  assert.equal(argv.includes("--settings"), false);
});
