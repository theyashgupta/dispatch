import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isolateTmuxEnv,
  readArgv,
  waitFor,
  writeFakeRepl,
} from "../../test-support/fixtures.js";
import { DEFAULT_BOARD_KEY } from "../../../shared/board-key.js";
import type { SagaContext } from "./steps.js";

const env = await isolateTmuxEnv();
fs.writeFileSync(
  path.join(env.home, ".zshrc"),
  '/bin/sh -c \'read -r -t 3 line && printf "%s" "$line" > "$HOME/swallowed"\'\n',
);
const tmux = await import("../../adapters/tmux.js");
const { store } = await import("../../store/board.store.js");
const { launchClaude, steps } = await import("./steps.js");
const { projectsDirOf } = await import("../../adapters/transcript.js");
const { setHooksRuntime, setOrchestrationConfig } =
  await import("../infra/config-holder.js");
setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
const HOSTILE_ARG = "be terse; $(id) `id` && echo pwned | cat";
setOrchestrationConfig({
  linearApiKey: "",
  claudeArgs: `--append-system-prompt '${HOSTILE_ARG}'`,
});

void test(
  "launchClaude waits for the login shell prompt, runs claude in it, survives Ctrl-C, and reuses the session without re-minting the hook token",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "shell session",
      "",
    );
    const tmuxSession = `dsp-launchtest-${process.pid}`;
    const target = `=${tmuxSession}:`;
    const cwd = path.join(env.root, "worktree");
    fs.mkdirSync(cwd, { recursive: true });
    let createdEvents = 0;
    const launch = (leadingArgs: string[]) =>
      launchClaude({
        cardId: card.id,
        tmuxSession,
        cwd,
        leadingArgs,
        account: { id: "default" },
        onCreated: () => {
          createdEvents += 1;
        },
      });
    try {
      assert.equal(await launch(["--continue"]), true);
      assert.equal(createdEvents, 1, "onCreated fires once the session exists");
      assert.deepEqual([...(await tmux.listSessions())], [tmuxSession]);
      assert.equal(
        await tmux.sessionEnvHas(`=${tmuxSession}`, "DISPATCH_SHELL_SESSION"),
        true,
        "a created session carries the shell marker",
      );
      assert.equal(
        fs.existsSync(path.join(env.home, "swallowed")),
        false,
        "the launch line is typed only once the rc has released the prompt",
      );
      const token = store.getCard(card.id)?.hookToken;
      assert.equal(typeof token, "string", "a created session minted a token");
      assert.deepEqual(
        readArgv(argvFile)?.filter((a) => !a.startsWith("/")),
        ["--continue", "--settings", "--append-system-prompt", HOSTILE_ARG],
        "a hostile Settings token reaches claude as one literal argument through the real typed path",
      );

      await tmux.sendKeys(target, ["C-c"]);
      await waitFor(
        () => tmux.paneAtPrompt(target),
        5000,
        "pane back at the login shell prompt after claude exits",
      );
      assert.equal(await tmux.hasSession(`=${tmuxSession}`), true);

      fs.rmSync(argvFile, { force: true });
      assert.equal(
        await launch([]),
        false,
        "a live session is reused, never re-created",
      );
      assert.equal(createdEvents, 1, "onCreated never fires on reuse");
      assert.deepEqual([...(await tmux.listSessions())], [tmuxSession]);
      assert.equal(
        store.getCard(card.id)?.hookToken,
        token,
        "a reused session keeps the token its shell already holds",
      );
      assert.deepEqual(
        readArgv(argvFile)?.filter((a) => !a.startsWith("/")),
        ["--settings", "--append-system-prompt", HOSTILE_ARG],
      );
      assert.equal(await tmux.paneAtPrompt(target), false);

      await tmux.sendKeys(target, ["C-c"]);
      await waitFor(() => tmux.paneAtPrompt(target), 5000, "prompt again");
      await tmux.killSession(`=${tmuxSession}`);
      fs.rmSync(argvFile, { force: true });
      setHooksRuntime({ capable: true, port: 1, statusChannel: "pane" });
      assert.equal(
        await launch([]),
        true,
        "a fresh session under the pane channel",
      );
      assert.deepEqual(
        readArgv(argvFile)?.filter((a) => !a.startsWith("/")),
        ["--append-system-prompt", HOSTILE_ARG],
        "the pane channel launches without the hooks settings layer",
      );
      assert.equal(
        store.getCard(card.id)?.hookToken,
        undefined,
        "the pane channel clears the card's hook token",
      );
    } finally {
      await tmux.killSession(`=${tmuxSession}`);
      await env.killServer();
    }
  },
);

void test(
  "launchClaude never clears a session's conversation nodes, so a Restart appends instead of resetting",
  { skip: !env.canRunRealTmux },
  async () => {
    const argvFile = path.join(env.root, "claude-argv-restart.txt");
    writeFakeRepl(env, argvFile);
    await store.load();
    const card = await store.createLocalCard(
      DEFAULT_BOARD_KEY,
      "restart keeps nodes",
      "",
    );
    const tmuxSession = `dsp-restarttest-${process.pid}`;
    const cwd = path.join(env.root, "worktree-restart");
    fs.mkdirSync(cwd, { recursive: true });
    await store.completeStart(card.id, undefined, {
      workspacePath: cwd,
      tmuxSession,
      branch: "restart-keeps-nodes",
    });
    const sessionId = store.getCard(card.id)!.activeSessionId!;
    await store.setClaudeSessionId(card.id, sessionId, "conv-before-restart");
    try {
      assert.equal(
        await launchClaude({
          cardId: card.id,
          sessionId,
          tmuxSession,
          cwd,
          leadingArgs: [],
          account: { id: "default" },
        }),
        true,
      );
      assert.deepEqual(
        store
          .getCard(card.id)
          ?.sessions?.find((s) => s.id === sessionId)
          ?.claudeSessions?.map((n) => n.id),
        ["conv-before-restart"],
      );
      assert.equal(
        store.getCard(card.id)?.claudeSessionId,
        "conv-before-restart",
      );
    } finally {
      await env.killServer();
    }
  },
);

const stepNamed = (name: string) => steps.find((s) => s.name === name)!;

async function kickoffWithRecordTimer(
  title: string,
  runtime: { capable: boolean; statusChannel: "auto" | "pane" },
) {
  const argvFile = path.join(env.root, `claude-argv-${title}.txt`);
  writeFakeRepl(env, argvFile);
  await store.load();
  const card = await store.createLocalCard(DEFAULT_BOARD_KEY, title, "");
  const branch = `${title}-${process.pid}`;
  const tmuxSession = `dsp-${branch}`;
  const cwd = path.join(env.root, `worktree-${title}`);
  fs.mkdirSync(cwd, { recursive: true });
  await store.completeStart(card.id, undefined, {
    workspacePath: cwd,
    tmuxSession,
    branch,
  });
  const folder = projectsDirOf(path.join(env.home, ".claude"), cwd);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "kickoff-conv.jsonl"), "");
  setHooksRuntime({ ...runtime, port: 1 });
  const ctx = {
    card: store.getCard(card.id)!,
    identifier: card.identifier,
    sessionName: branch,
    sessionId: undefined,
    workspacePath: cwd,
    extraDirection: "",
    createdWorkspaceDir: false,
    createdWorktrees: [],
    createdBranches: [],
    tmuxSessionCreated: false,
    restarted: false,
    warnings: [],
  } as unknown as SagaContext;
  const original = globalThis.setTimeout;
  const recordTimers: (() => void)[] = [];
  const spy = mock.method(globalThis, "setTimeout", ((
    fn: () => void,
    ms?: number,
    ...rest: unknown[]
  ) => {
    if (ms !== 5000) return original(fn, ms, ...rest);
    recordTimers.push(fn);
    return { unref: () => undefined };
  }) as typeof setTimeout);
  try {
    await stepNamed("starting claude").run(ctx);
    await stepNamed("sending kickoff").run(ctx);
  } finally {
    spy.mock.restore();
  }
  return {
    cardId: card.id,
    recordTimers,
    mirror: () => store.getCard(card.id)?.claudeSessionId,
    cleanup: async () => {
      setHooksRuntime({ capable: true, port: 1, statusChannel: "auto" });
      await tmux.killSession(`=${tmuxSession}`);
      await env.killServer();
    },
  };
}

for (const [title, label, runtime] of [
  ["silent-pane", "the pane channel", { capable: true, statusChannel: "pane" }],
  [
    "silent-auto",
    "an auto channel with no hook capable CLI",
    { capable: false, statusChannel: "auto" },
  ],
] as const) {
  void test(
    `a hook silent kickoff records the newest conversation file 5 s later under ${label}`,
    { skip: !env.canRunRealTmux },
    async () => {
      const run = await kickoffWithRecordTimer(title, runtime);
      try {
        assert.equal(run.recordTimers.length, 1);
        assert.equal(
          run.mirror(),
          undefined,
          "nothing is recorded before the delay",
        );
        run.recordTimers[0]();
        await waitFor(
          () => Promise.resolve(run.mirror() === "kickoff-conv"),
          5000,
          "the folder read to record the conversation",
        );
      } finally {
        await run.cleanup();
      }
    },
  );
}

void test(
  "a hook capable kickoff schedules no folder read",
  { skip: !env.canRunRealTmux },
  async () => {
    const run = await kickoffWithRecordTimer("capable-kickoff", {
      capable: true,
      statusChannel: "auto",
    });
    try {
      assert.equal(run.recordTimers.length, 0);
      assert.equal(run.mirror(), undefined);
    } finally {
      await run.cleanup();
    }
  },
);

void test.after(() => env.cleanup());
