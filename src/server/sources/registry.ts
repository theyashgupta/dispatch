import type { Config } from "../../shared/types.js";
import type { TicketSource } from "./TicketSource.js";
import { LinearSource } from "./linear/LinearSource.js";

/** The boot-built ticket sources, keyed by id. Empty until buildRegistry() runs at boot. */
const sources = new Map<string, TicketSource>();

/** index.ts calls this right after loadConfig() to construct the sources from config, before startPoller. */
export function buildRegistry(config: Config): void {
  sources.clear();
  const linear = new LinearSource(config.linearApiKey);
  sources.set(linear.id, linear);
}

/** Look up a source by id (poller/boot read the linear source through this). */
export function getSource(id: string): TicketSource | undefined {
  return sources.get(id);
}

/** The single Linear source; throws if buildRegistry() has not run (a boot-order bug). */
export function getLinearSource(): TicketSource {
  const linear = sources.get("linear");
  if (!linear) {
    throw new Error("linear source not built — buildRegistry() must run at boot");
  }
  return linear;
}
