import type { Config } from "../../shared/types.js";

/** The loaded config, pushed in once by index.ts at boot. null until set (route → 400 if unset). */
let orchestrationConfig: Config | null = null;

/** index.ts calls this with the loaded config right after loadConfig(), before listen(). */
export function setOrchestrationConfig(config: Config): void {
  orchestrationConfig = config;
}

/** The start route reads the loaded config through this (never calls loadConfig itself). */
export function getOrchestrationConfig(): Config | null {
  return orchestrationConfig;
}
