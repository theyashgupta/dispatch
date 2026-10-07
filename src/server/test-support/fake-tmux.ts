import fs from "node:fs";
import path from "node:path";
import type { IsolatedEnv } from "./fixtures.js";

export const IDLE_PANE = "> \n? for shortcuts\n";
export const BUSY_PANE = "* Working... (esc to interrupt)\n";
export const LIMIT_PANE =
  "Usage limit reached · continuing automatically at 10:40am · esc to cancel\n";
export const NO_STOP_LIMIT_PANE =
  "What do you want to do?\n\n ❯ 1. Switch to usage credits\n   2. Upgrade your plan\n";

/**
 * Put a fake `tmux` and `ps` on the isolated PATH and return the directory that drives them.
 *
 * @remarks State files in the returned `state` directory steer the fakes: `pane` or `pane.<name>` is the capture, `legacy` hides the shell marker, `dead.<name>` ends one tmux session, `stuck` stops a `/exit` from returning the shell, and `at-prompt` puts the shell in the foreground from the start. A typed `--resume` or bare `--dangerously-skip-permissions` launch line blanks the pane for one capture and then restores it unless `sticky` exists, a `--resume` of a `missing-` id shows the no-conversation error, a `C-l` key blanks the pane to a bare prompt until the next launch line restores it unless `no-clear` exists, a `launched` file is the screen a launch line leaves behind in place of the pane it found, and the file that `FAKE_TRUST_PROBE` names is copied to `trust-at-launch` at the launch. Each key send (not a literal one) moves the first `next.<name>.<n>` file to `pane.<name>`, so a test scripts how a pane answers its keys.
 */
export function installFakeTmux(env: Pick<IsolatedEnv, "root" | "binDir">): {
  state: string;
  reset: (files?: Record<string, string>) => void;
} {
  const state = path.join(env.root, "fake-tmux");
  fs.mkdirSync(state);
  process.env.FAKE_TMUX_STATE = state;
  fs.writeFileSync(
    path.join(env.binDir, "tmux"),
    `#!/bin/bash
state="$FAKE_TMUX_STATE"
if [ "$1" = "-L" ]; then shift 2; fi
( IFS=$'\\t'; printf '%s\\n' "$*" ) >> "$state/calls.log"
target=""; prev=""
for a in "$@"; do [ "$prev" = "-t" ] && target="$a"; prev="$a"; done
name="\${target#=}"; name="\${name%:}"
pid=$(printf '%s' "$name" | cksum | cut -d' ' -f1)
case "$1" in
  has-session) [ -f "$state/dead.$name" ] && exit 1 ;;
  show-environment)
    if [ "$4" = DISPATCH_SHELL_SESSION ] && [ ! -f "$state/legacy" ]; then
      echo "DISPATCH_SHELL_SESSION=1"
    else
      exit 1
    fi
    ;;
  display-message) echo "$pid" ;;
  capture-pane)
    if [ -f "$state/pane.$name" ]; then cat "$state/pane.$name"; else cat "$state/pane"; fi
    if [ -f "$state/after.$name" ]; then mv "$state/after.$name" "$state/pane.$name"; fi
    ;;
  send-keys)
    for lit in "$@"; do :; done
    if [ "$2" = "-l" ] && [ "$lit" = "/exit" ] && [ ! -f "$state/stuck" ]; then touch "$state/at-prompt.$pid"; fi
    if [ "$2" = "-l" ]; then
      case "$lit" in
        *"'--resume' 'missing-"*) echo "No conversation found with session ID" > "$state/pane.$name"; rm -f "$state/cleared.$name" ;;
        *"'--resume'"*|*"'--dangerously-skip-permissions'"*)
          [ -f "$FAKE_TRUST_PROBE" ] && cp "$FAKE_TRUST_PROBE" "$state/trust-at-launch"
          if [ -f "$state/launched" ]; then src="$state/launched"; elif [ -f "$state/cleared.$name" ]; then src="$state/cleared.$name"; elif [ -f "$state/pane.$name" ]; then src="$state/pane.$name"; else src="$state/pane"; fi
          if [ ! -f "$state/sticky" ]; then
            cp "$src" "$state/after.$name"
            echo "$ launching" > "$state/pane.$name"
          elif [ -f "$state/cleared.$name" ]; then
            cp "$src" "$state/pane.$name"
          fi
          rm -f "$state/cleared.$name"
          ;;
      esac
    fi
    if [ "$2" != "-l" ]; then
      for next in "$state/next.$name".*; do
        [ -f "$next" ] && mv "$next" "$state/pane.$name"
        break
      done
      for key in "$@"; do
        if [ "$key" = "C-l" ] && [ ! -f "$state/no-clear" ]; then
          if [ -f "$state/pane.$name" ]; then cp "$state/pane.$name" "$state/cleared.$name"; else cp "$state/pane" "$state/cleared.$name"; fi
          echo '$ ' > "$state/pane.$name"
        fi
      done
    fi
    ;;
esac
exit 0
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(env.binDir, "ps"),
    `#!/bin/sh
for a in "$@"; do pid="$a"; done
if [ -f "$FAKE_TMUX_STATE/at-prompt.$pid" ] || [ -f "$FAKE_TMUX_STATE/at-prompt" ]; then echo "1 1"; else echo "1 2"; fi
`,
    { mode: 0o755 },
  );
  const reset = (files: Record<string, string> = {}): void => {
    for (const name of fs.readdirSync(state)) fs.rmSync(path.join(state, name));
    fs.writeFileSync(path.join(state, "pane"), IDLE_PANE);
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(state, name), body);
    }
  };
  reset();
  return { state, reset };
}
