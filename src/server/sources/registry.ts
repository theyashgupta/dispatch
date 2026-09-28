import type { Config, SourceCredential } from "../../shared/types.js";
import {
  DEFAULT_FILTERS,
  DEFAULT_POLL_INTERVAL_MS,
} from "../../shared/types.js";
import type { TicketSource } from "./ticket.source.js";
import { GitHubSource } from "./github/github.source.js";
import { LinearSource } from "./linear/linear.source.js";
import { SentrySource } from "./sentry/sentry.source.js";

/** The boot-built ticket sources, keyed by id. Empty until buildRegistry() runs at boot. */
const sources = new Map<string, TicketSource>();

const enabled = new Set<string>();

type CredentialResolver = () => Promise<SourceCredential | null>;

const noCredential: CredentialResolver = () => Promise.resolve(null);

const resolvers = new Map<string, CredentialResolver>();

/**
 * Register the function a token-based source calls on every fetch to read its credential.
 *
 * @remarks Bootstrap sets it before the first build, because sources may not import the Vault or
 * the exec chokepoint themselves. A source with no resolver sees no credential.
 */
export function setCredentialResolver(
  id: string,
  resolve: CredentialResolver,
): void {
  resolvers.set(id, resolve);
}

/**
 * Construct every known source from config and record which ones are enabled.
 *
 * @remarks Every source object is built even when disabled, because the filter and options routes
 * need the Linear object with an empty key; only the poll loop consults the enabled set. The Linear
 * source reads filters through a live accessor over the SAME `config` object, which
 * `updateSourceFilters` mutates in place, so a settings save is visible to the next poll.
 */
export function buildRegistry(config: Config): void {
  sources.clear();
  enabled.clear();
  const linearConfig = config.sources?.linear;
  const linear = new LinearSource(
    config.linearApiKey,
    () => linearConfig?.filters ?? DEFAULT_FILTERS,
    linearConfig?.pollIntervalMs ??
      config.pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS,
  );
  sources.set(linear.id, linear);
  if (linearConfig?.enabled !== false && config.linearApiKey !== "") {
    enabled.add(linear.id);
  }
  const githubConfig = config.sources?.github;
  const github = new GitHubSource(
    () => (resolvers.get("github") ?? noCredential)(),
    githubConfig?.pollIntervalMs ??
      config.pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS,
  );
  sources.set(github.id, github);
  if (githubConfig?.enabled === true) enabled.add(github.id);
  const sentryConfig = config.sources?.sentry;
  const sentry = new SentrySource(
    () => (resolvers.get("sentry") ?? noCredential)(),
    sentryConfig?.pollIntervalMs ??
      config.pollIntervalMs ??
      DEFAULT_POLL_INTERVAL_MS,
  );
  sources.set(sentry.id, sentry);
  if (sentryConfig?.enabled === true) enabled.add(sentry.id);
}

export function getSource(id: string): TicketSource | undefined {
  return sources.get(id);
}

export function listSources(): TicketSource[] {
  return [...sources.values()];
}

export function isSourceEnabled(id: string): boolean {
  return enabled.has(id);
}

/** The sources the poll loop should run, in registration order. */
export function enabledSources(): TicketSource[] {
  return listSources().filter((s) => enabled.has(s.id));
}

/** The single Linear source; throws if buildRegistry() has not run (a boot-order bug). */
export function getLinearSource(): TicketSource {
  const linear = getSource("linear");
  if (!linear) {
    throw new Error(
      "linear source not built, buildRegistry() must run at boot",
    );
  }
  return linear;
}
