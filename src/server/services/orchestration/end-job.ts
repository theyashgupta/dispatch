import { signalSafe } from "../../adapters/process-tree.js";
import type { paneTerminal } from "../../adapters/tmux.js";
import { waitFor } from "./supervisor-send.js";

export interface EndJobTools {
  paneTerminal: typeof paneTerminal;
  kill: (pid: number, signal: "SIGHUP" | "SIGKILL") => void;
  atShellPrompt: (target: string) => Promise<boolean>;
  grace: { hangupMs: number; killMs: number; pollMs: number };
}

/**
 * End the foreground job of a pane: hang it up, then kill it if the shell does not return.
 *
 * @remarks Never signals the shell group, so a pane already at its prompt is left alone. The kill
 * goes out only when the same group still owns the terminal, so a pid reused meanwhile is spared.
 */
export async function endJob(
  target: string,
  tools: EndJobTools,
): Promise<void> {
  const read = () =>
    Promise.resolve(tools.paneTerminal(target)).catch(() => null);
  const terminal = await read();
  if (!terminal || terminal.tpgid === terminal.pgid) return;
  if (!signalSafe(terminal.tpgid)) return;
  const signal = (name: "SIGHUP" | "SIGKILL") => {
    try {
      tools.kill(-terminal.tpgid, name);
    } catch {
      return;
    }
  };
  const atPrompt = () => tools.atShellPrompt(target);
  const { hangupMs, killMs, pollMs } = tools.grace;
  signal("SIGHUP");
  if (await waitFor(atPrompt, hangupMs, pollMs)) return;
  if ((await read())?.tpgid !== terminal.tpgid) return;
  signal("SIGKILL");
  await waitFor(atPrompt, killMs, pollMs);
}
