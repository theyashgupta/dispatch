import fs from "node:fs";
import writeFileAtomic from "write-file-atomic";
import type { Config, SourceFilters } from "../../shared/types.js";
import { CONFIG_PATH } from "./paths.js";

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

/**
 * Persist a source's filter selection to `~/.dispatch/config.json` and make it live immediately.
 *
 * @remarks The single writer for the secret-adjacent config file. It re-reads the raw file, mutates
 * ONLY `sources.linear.filters`, and carries every other top-level key plus `sources.linear.apiKey`
 * forward verbatim, so the write never drops the Linear key or a user-added field. The write is
 * atomic at mode 0600 because the file holds the API key at rest; the key is never read, logged, or
 * returned — it is copied as an opaque value. The held in-memory Config is mutated IN PLACE so the
 * registry's live-filters accessor closure sees the new scope on the very next poll with no restart.
 * A JSON parse failure reports the byte position only, never the parser message, which embeds a
 * snippet of the file around the failure — and a mis-quoted key sits exactly there.
 */
export function updateSourceFilters(
  sourceId: string,
  filters: SourceFilters,
): void {
  if (sourceId !== "linear") {
    throw new Error(`unknown source: ${sourceId}`);
  }

  const raw = fs.readFileSync(CONFIG_PATH, "utf8");
  let parsed: Record<string, unknown>;
  try {
    const p = JSON.parse(raw) as unknown;
    if (typeof p !== "object" || p === null || Array.isArray(p)) {
      throw new Error("not an object");
    }
    parsed = p as Record<string, unknown>;
  } catch (err) {
    const pos = /position (\d+)/.exec((err as Error).message)?.[1];
    throw new Error(
      `config at ${CONFIG_PATH} is not valid JSON${pos ? ` (near position ${pos})` : ""}`,
    );
  }

  const priorSources =
    typeof parsed.sources === "object" &&
    parsed.sources !== null &&
    !Array.isArray(parsed.sources)
      ? (parsed.sources as Record<string, unknown>)
      : {};
  const priorLinear =
    typeof priorSources.linear === "object" &&
    priorSources.linear !== null &&
    !Array.isArray(priorSources.linear)
      ? (priorSources.linear as Record<string, unknown>)
      : {};

  const next = {
    ...parsed,
    sources: {
      ...priorSources,
      linear: { ...priorLinear, filters },
    },
  };

  writeFileAtomic.sync(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", {
    mode: 0o600,
  });
  fs.chmodSync(CONFIG_PATH, 0o600);

  if (orchestrationConfig?.sources?.linear) {
    orchestrationConfig.sources.linear.filters = filters;
  }
}
