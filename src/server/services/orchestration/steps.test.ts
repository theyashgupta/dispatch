import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isolateTmuxEnv,
  readArgv,
  waitFor,
  writeFakeRepl,
} from "../../test-support/fixtures.js";

const env = await isolateTmuxEnv();
fs.writeFileSync(
  path.join(env.home, ".zshrc"),
  '/bin/sh -c \'read -r -t 3 line && printf "%s" "$line" > "$HOME/swallowed"\'\n',
);
const tmux = await import("../../adapters/tmux.js");
const { store } = await import("../../store/board.store.js");
const { launchClaude } = await import("./steps.js");
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
    const card = await store.createLocalCard("shell session", "");
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

void test.after(() => env.cleanup());
