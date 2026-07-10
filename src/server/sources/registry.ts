import type { Config } from "../../shared/types.js";
import { DEFAULT_FILTERS } from "../../shared/types.js";
import type { TicketSource } from "./TicketSource.js";
import { LinearSource } from "./linear/LinearSource.js";

/** The boot-built ticket sources, keyed by id. Empty until buildRegistry() runs at boot. */
const sources = new Map<string, TicketSource>();

/**
 * index.ts calls this right after loadConfig() to construct the sources from config, before
 * startPoller. The Linear source keeps the key in its constructor but reads filters through a live
 * accessor over the SAME `config` object — Plan 02's `updateSourceFilters` mutates that object in
 * place, so a settings save is visible to the next poll with no reconstruction and no boundary-
 * crossing import into `services`.
 */
export function buildRegistry(config: Config): void {
  sources.clear();
  const linear = new LinearSource(
    config.linearApiKey,
    () => config.sources?.linear?.filters ?? DEFAULT_FILTERS,
  );
  sources.set(linear.id, linear);
}

/** Look up a source by id (the by-id accessor the boot convenience getters read through). */
function getSource(id: string): TicketSource | undefined {
  return sources.get(id);
}

/** The single Linear source; throws if buildRegistry() has not run (a boot-order bug). */
export function getLinearSource(): TicketSource {
  const linear = getSource("linear");
  if (!linear) {
    throw new Error(
      "linear source not built — buildRegistry() must run at boot",
    );
  }
  return linear;
}
