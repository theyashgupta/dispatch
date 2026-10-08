import { spawnPiped } from "./exec.js";

type ChildProcess = ReturnType<typeof spawnPiped>;
type Spawner = (cmd: string, args: string[]) => ChildProcess;

export interface PowerHolder {
  set: (wanted: boolean) => void;
  pid: () => number | null;
}

/**
 * Build a holder that keeps one `caffeinate -is` child alive while wanted and ends it when not.
 *
 * @remarks `-w` ties the child to this server's pid, so a crashed server never leaves the Mac
 * held awake.
 */
export function createPowerHolder(
  spawner: Spawner = (cmd, args) => spawnPiped(cmd, args),
): PowerHolder {
  let child: ChildProcess | null = null;
  return {
    set(wanted) {
      if (wanted && child === null) {
        const started = spawner("caffeinate", [
          "-is",
          "-w",
          String(process.pid),
        ]);
        const forget = () => {
          if (child === started) child = null;
        };
        started.on("exit", forget);
        started.on("error", forget);
        child = started;
      } else if (!wanted && child !== null) {
        child.kill();
        child = null;
      }
    },
    pid: () => child?.pid ?? null,
  };
}

export const power = createPowerHolder();
