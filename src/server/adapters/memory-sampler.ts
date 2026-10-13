import type { MemorySample } from "../../shared/types.js";
import { run } from "./exec.js";

const BYTES_PER_MB = 1024 * 1024;
const UNIT_MB: Record<string, number> = { K: 1 / 1024, M: 1, G: 1024 };

/**
 * Read free plus inactive memory and the compressor size from `vm_stat` output, in whole MB.
 *
 * @remarks The page size comes from the header line, because it is 16 KB on Apple silicon and
 * 4 KB on Intel.
 */
export function parseVmStat(
  text: string,
): { freeMb: number; compressorMb: number } | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = (label: string): number =>
    Number(new RegExp(`^${label}:\\s+(\\d+)\\.`, "m").exec(text)?.[1]);
  const free = pages("Pages free");
  const inactive = pages("Pages inactive");
  const compressor = pages("Pages occupied by compressor");
  if (![pageSize, free, inactive, compressor].every(Number.isFinite)) {
    return null;
  }
  return {
    freeMb: Math.round(((free + inactive) * pageSize) / BYTES_PER_MB),
    compressorMb: Math.round((compressor * pageSize) / BYTES_PER_MB),
  };
}

/** Read swap used, swap total and the 1-minute load average from `sysctl -n vm.swapusage vm.loadavg` output. */
export function parseSysctl(
  text: string,
): { swapUsedMb: number; swapTotalMb: number; load1: number } | null {
  const sizeMb = (label: string): number => {
    const match = new RegExp(`${label} = ([\\d.]+)([KMG])`).exec(text);
    return match ? Math.round(Number(match[1]) * UNIT_MB[match[2]]) : NaN;
  };
  const swapUsedMb = sizeMb("used");
  const swapTotalMb = sizeMb("total");
  const load1 = Number(/\{ ([\d.]+) /.exec(text)?.[1]);
  if (![swapUsedMb, swapTotalMb, load1].every(Number.isFinite)) return null;
  return { swapUsedMb, swapTotalMb, load1 };
}

let failing = false;

/**
 * Sample the machine memory, or null off macOS or when a command or a parse fails.
 *
 * @remarks Never throws, so one bad tick cannot stop the sampling timer. A failure on macOS is
 * logged once per run of failures, so a broken reader is visible without a line every 15 s.
 */
export async function readMemory(
  platform: NodeJS.Platform = process.platform,
): Promise<MemorySample | null> {
  if (platform !== "darwin") return null;
  try {
    const [vm, sysctl] = await Promise.all([
      run("vm_stat", [], { timeout: 5_000 }),
      run("sysctl", ["-n", "vm.swapusage", "vm.loadavg"], { timeout: 5_000 }),
    ]);
    const pages = parseVmStat(vm.stdout);
    const swap = parseSysctl(sysctl.stdout);
    if (pages === null || swap === null) return readFailed("unparsed output");
    failing = false;
    return { at: new Date().toISOString(), ...pages, ...swap };
  } catch (err) {
    return readFailed((err as Error).message);
  }
}

/** Log the first failure of a run of failed reads and answer no reading. */
function readFailed(why: string): null {
  if (!failing) console.warn(`[memory] read failed: ${why}`);
  failing = true;
  return null;
}
