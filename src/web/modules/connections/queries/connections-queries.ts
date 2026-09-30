import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  getLinearFilters,
  getLinearOptions,
  getLinearWorkflow,
  getSavedSlackChannels,
  getSourceConnection,
  listSlackChannels,
  type LinearOptionDimension,
} from "./connections-api.js";

export const connectionsKeys = {
  all: ["connections"] as const,
  detail: (source: string) => ["connections", "source", source] as const,
  linearFilters: ["connections", "linear", "filters"] as const,
  linearOptions: (dimension: LinearOptionDimension) =>
    ["connections", "linear", "options", dimension] as const,
  linearWorkflow: ["connections", "linear", "workflow"] as const,
  savedSlackChannels: ["connections", "slack", "saved-channels"] as const,
  slackChannels: ["connections", "slack", "channels"] as const,
};

export function sourceConnectionQueryOptions(source: string) {
  return queryOptions({
    queryKey: connectionsKeys.detail(source),
    queryFn: () => getSourceConnection(source),
  });
}

export function linearFiltersQueryOptions() {
  return queryOptions({
    queryKey: connectionsKeys.linearFilters,
    queryFn: getLinearFilters,
  });
}

export function linearOptionsQueryOptions(dimension: LinearOptionDimension) {
  return queryOptions({
    queryKey: connectionsKeys.linearOptions(dimension),
    queryFn: () => getLinearOptions(dimension),
  });
}

export function linearWorkflowQueryOptions() {
  return queryOptions({
    queryKey: connectionsKeys.linearWorkflow,
    queryFn: getLinearWorkflow,
    staleTime: 0,
  });
}

export function savedSlackChannelsQueryOptions() {
  return queryOptions({
    queryKey: connectionsKeys.savedSlackChannels,
    queryFn: getSavedSlackChannels,
    staleTime: 0,
  });
}

export function slackChannelsQueryOptions() {
  return queryOptions({
    queryKey: connectionsKeys.slackChannels,
    queryFn: listSlackChannels,
    staleTime: 0,
  });
}

export function useSourceConnectionQuery(source: string) {
  return useQuery(sourceConnectionQueryOptions(source));
}
