import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  getArchiveRetention,
  getCleanupDelay,
  getClaudeArgs,
  getLinearStateMap,
  getProfile,
  getTerminalAppearance,
} from "./settings-api.js";

export const settingsKeys = {
  all: ["settings"] as const,
  cleanupDelay: ["settings", "cleanup-delay"] as const,
  terminal: ["settings", "terminal"] as const,
  claudeArgs: ["settings", "claude-args"] as const,
  linearStateMap: ["settings", "linear-state-map"] as const,
  profile: ["settings", "profile"] as const,
  archiveRetention: ["settings", "archive-retention"] as const,
};

export function cleanupDelayQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.cleanupDelay,
    queryFn: getCleanupDelay,
  });
}

export function terminalAppearanceQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.terminal,
    queryFn: getTerminalAppearance,
  });
}

export function claudeArgsQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.claudeArgs,
    queryFn: getClaudeArgs,
  });
}

export function linearStateMapQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.linearStateMap,
    queryFn: getLinearStateMap,
  });
}

export function profileQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.profile,
    queryFn: getProfile,
  });
}

export function archiveRetentionQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.archiveRetention,
    queryFn: getArchiveRetention,
  });
}

export function useProfileQuery() {
  return useQuery(profileQueryOptions());
}
