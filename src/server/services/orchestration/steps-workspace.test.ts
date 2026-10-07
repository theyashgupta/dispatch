import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { BoardKey, Card, Config } from "../../../shared/types.js";
import { DEFAULT_BOARD_KEY, parseBoardKey } from "../../../shared/board-key.js";
import { isolateEnv } from "../../test-support/fixtures.js";

const env = isolateEnv();
const { store } = await import("../../store/board.store.js");
const { steps, StartStepError } = await import("./steps.js");
type SagaContext = Parameters<(typeof steps)[number]["run"]>[0];

after(() => env.cleanup());

const ACME = parseBoardKey("ACME") as BoardKey;
const localRoot = path.join(env.root, "local-sessions");
const acmeRoot = path.join(env.root, "acme-sessions");
fs.mkdirSync(localRoot);
fs.mkdirSync(acmeRoot);

await store.load();
await store.createBoard({
  key: ACME,
  name: "Acme",
  workspaceRoot: acmeRoot,
  repositories: [],
  linearTeamKeys: [],
});
const acmeCard = await store.createLocalCard(ACME, "acme card", "");
const localCard = await store.createLocalCard(DEFAULT_BOARD_KEY, "local", "");

const prepareWorkspace = steps[0];

function ctxFor(
  card: Card,
  config: Partial<Config>,
  sessionName = card.identifier,
): SagaContext {
  return {
    card,
    identifier: card.identifier,
    sessionName,
    sessionId: undefined,
    workspacePath: "",
    extraDirection: "",
    config: { linearApiKey: "", ...config },
    createdWorkspaceDir: false,
    createdWorktrees: [],
    createdBranches: [],
    tmuxSessionCreated: false,
    restarted: false,
    warnings: [],
  };
}

test("an ACME card's workspace is created under the ACME folder, not Config.workspaceRoot", async () => {
  const ctx = ctxFor(acmeCard, { workspaceRoot: localRoot });
  await prepareWorkspace.run(ctx);

  assert.equal(ctx.workspacePath, path.join(acmeRoot, acmeCard.identifier));
  assert.ok(fs.statSync(ctx.workspacePath).isDirectory());
  assert.deepEqual(fs.readdirSync(localRoot), []);
});

test("a LOCAL card keeps Config.workspaceRoot", async () => {
  const ctx = ctxFor(localCard, { workspaceRoot: localRoot });
  await prepareWorkspace.run(ctx);

  assert.equal(ctx.workspacePath, path.join(localRoot, localCard.identifier));
  assert.ok(fs.statSync(ctx.workspacePath).isDirectory());
});

test("a session name that escapes the board folder is rejected", async () => {
  const ctx = ctxFor(acmeCard, { workspaceRoot: localRoot }, "../escaped");

  await assert.rejects(
    prepareWorkspace.run(ctx),
    (err: unknown) =>
      err instanceof StartStepError &&
      err.step === "preparing workspace" &&
      /escapes the board folder/.test(err.stderr),
  );
  assert.equal(fs.existsSync(path.join(env.root, "escaped")), false);
  assert.equal(fs.existsSync(path.join(acmeRoot, "..", "escaped")), false);
});

test("a board with no folder fails the step with the config error", async () => {
  const ctx = ctxFor(localCard, {});

  await assert.rejects(
    prepareWorkspace.run(ctx),
    (err: unknown) =>
      err instanceof StartStepError &&
      err.variant === "config" &&
      err.stderr === "workspaceRoot is not configured",
  );
});
