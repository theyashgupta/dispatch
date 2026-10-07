import { useCallback, useState } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  CalendarSettingsPatch,
  LinearStateMap,
  SlackChannel,
  SourceFilters,
  SourceKeyError,
} from "../../../../shared/types.js";
import {
  connectionFromRead,
  startedConnectedFrom,
  type CredentialBusy,
} from "@/modules/connections/domain/source-connection-state";
import { granolaPollInterval } from "@/modules/connections/domain/granola-round";
import {
  calendarStatusKeys,
  calendarStatusQueryOptions,
} from "@/queries/calendar-status-queries";
import { granolaQueryOptions } from "@/queries/granola-queries";
import {
  useConnectSourceMutation,
  useDeleteSourceKeyMutation,
  useDisableSourceMutation,
  useSaveSourceKeyMutation,
  useSourceConnectionQuery,
} from "@/queries/source-connection-queries";
import {
  getLinearFilters,
  getLinearOptions,
  getLinearStateMap,
  getSavedSlackChannels,
  listCalendars,
  listSlackChannels,
  previewLinearFilters,
  putCalendarSettings,
  resolveSlackChannel,
  saveLinearFilters,
  saveLinearStateMap,
  saveSlackChannels,
  type LinearOptionDimension,
} from "./connections-api.js";

export const connectionsKeys = {
  all: ["connections"] as const,
  detail: (source: string) => ["connections", "source", source] as const,
  linearFilters: ["connections", "linear", "filters"] as const,
  linearPreview: (filters: SourceFilters) =>
    ["connections", "linear", "preview", filters] as const,
  linearOptions: (dimension: LinearOptionDimension) =>
    ["connections", "linear", "options", dimension] as const,
  linearStateMap: ["settings", "linear-state-map"] as const,
  savedSlackChannels: ["connections", "slack", "saved-channels"] as const,
  slackChannels: ["connections", "slack", "channels"] as const,
};

export function linearFiltersQueryOptions() {
  return queryOptions({
    queryKey: connectionsKeys.linearFilters,
    queryFn: getLinearFilters,
    refetchOnReconnect: false,
  });
}

export function linearOptionsQueryOptions(dimension: LinearOptionDimension) {
  return queryOptions({
    queryKey: connectionsKeys.linearOptions(dimension),
    queryFn: () => getLinearOptions(dimension),
  });
}

export function linearStateMapQueryOptions() {
  return queryOptions({
    queryKey: connectionsKeys.linearStateMap,
    queryFn: getLinearStateMap,
  });
}

export function savedSlackChannelsQueryOptions() {
  return queryOptions({
    queryKey: connectionsKeys.savedSlackChannels,
    queryFn: getSavedSlackChannels,
    staleTime: 0,
    refetchOnReconnect: false,
  });
}

export function slackChannelsQueryOptions() {
  return queryOptions({
    queryKey: connectionsKeys.slackChannels,
    queryFn: listSlackChannels,
    staleTime: 0,
  });
}

export function linearPreviewQueryOptions(filters: SourceFilters) {
  return queryOptions({
    queryKey: connectionsKeys.linearPreview(filters),
    queryFn: () => previewLinearFilters(filters),
    staleTime: 0,
  });
}

/**
 * Read the Granola status, polling only while a round runs.
 *
 * @remarks
 * The status is re-read on mount, after every action and every 5 s only while a round runs, so an
 * idle Settings page makes no background requests.
 */
export function useGranolaStatusQuery() {
  return useQuery({
    ...granolaQueryOptions(),
    refetchOnMount: "always",
    refetchInterval: (query) => granolaPollInterval(query.state.data),
    refetchIntervalInBackground: true,
  });
}

export function useLinearFiltersQuery(enabled: boolean) {
  return useQuery({
    ...linearFiltersQueryOptions(),
    enabled,
    refetchOnMount: "always",
  });
}

export function useLinearOptionsQuery(
  dimension: LinearOptionDimension,
  enabled: boolean,
) {
  return useQuery({
    ...linearOptionsQueryOptions(dimension),
    enabled,
    refetchOnMount: "always",
  });
}

export function useLinearPreviewQuery(filters: SourceFilters | null) {
  return useQuery({
    ...linearPreviewQueryOptions(
      filters ?? {
        assignees: [],
        projects: [],
        teams: [],
        currentCycle: false,
        includeActive: false,
      },
    ),
    enabled: filters !== null,
  });
}

/**
 * Re-read the Linear filters, the three option lists and the match preview.
 *
 * @remarks
 * Used when the connected Linear account changes, so the lists and the count belong to the new
 * account. The preview is keyed by the draft value, so a reload with equal filters would otherwise
 * keep the old account's count.
 */
export function refreshLinearFilters(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ["connections", "linear"] });
}

export function useRefreshLinearFilters() {
  const queryClient = useQueryClient();
  return useCallback(() => refreshLinearFilters(queryClient), [queryClient]);
}

/**
 * Build the mutation options that save the Linear filter draft.
 *
 * @remarks
 * An accepted save writes the draft into the cached filters, so the next read starts from what was
 * saved. A refused save (400) resolves `{ ok: false }` and leaves the cache alone.
 */
export function saveLinearFiltersMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (filters: SourceFilters) => saveLinearFilters(filters),
    onSuccess: (
      result: Awaited<ReturnType<typeof saveLinearFilters>>,
      filters: SourceFilters,
    ) => {
      if (!result.ok) return;
      queryClient.setQueryData(
        connectionsKeys.linearFilters,
        (old: Awaited<ReturnType<typeof getLinearFilters>> | undefined) =>
          old && { ...old, filters },
      );
    },
  };
}

export function useSaveLinearFiltersMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveLinearFiltersMutationOptions(queryClient));
}

export function useLinearStateMapQuery() {
  return useQuery({
    ...linearStateMapQueryOptions(),
    refetchOnMount: "always",
  });
}

/**
 * Build the mutation options that save the whole column-to-state map.
 *
 * @remarks
 * An accepted save writes the saved map into the cache. A refusal resolves `{ ok: false }` with the
 * message to show.
 */
export function saveLinearStateMapMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (stateMap: LinearStateMap) => saveLinearStateMap(stateMap),
    onSuccess: (
      result: Awaited<ReturnType<typeof saveLinearStateMap>>,
      stateMap: LinearStateMap,
    ) => {
      if (result.ok) {
        queryClient.setQueryData(connectionsKeys.linearStateMap, stateMap);
      }
    },
  };
}

export function useSaveLinearStateMapMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveLinearStateMapMutationOptions(queryClient));
}

export function useSavedSlackChannelsQuery() {
  return useQuery(savedSlackChannelsQueryOptions());
}

export function useSlackChannelsQuery(enabled: boolean) {
  return useQuery({ ...slackChannelsQueryOptions(), enabled });
}

export const resolveSlackChannelMutationOptions = {
  mutationFn: (input: string) => resolveSlackChannel(input),
};

export function useResolveSlackChannelMutation() {
  return useMutation(resolveSlackChannelMutationOptions);
}

/**
 * Build the mutation options that save the picked Slack channels.
 *
 * @remarks
 * A saved list is written into the cached saved channels. A failed save answers null and leaves the
 * cache alone, so the picker keeps the picks.
 */
export function saveSlackChannelsMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (channels: SlackChannel[]) => saveSlackChannels(channels),
    onSuccess: (stored: SlackChannel[] | null) => {
      if (stored) {
        queryClient.setQueryData(connectionsKeys.savedSlackChannels, stored);
      }
    },
  };
}

export function useSaveSlackChannelsMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveSlackChannelsMutationOptions(queryClient));
}

export function useCalendarConnectionStatusQuery() {
  return useQuery({
    ...calendarStatusQueryOptions(),
    refetchOnMount: "always",
  });
}

export const listCalendarsMutationOptions = {
  mutationFn: () => listCalendars(),
};

export function useListCalendarsMutation() {
  return useMutation(listCalendarsMutationOptions);
}

/**
 * Build the mutation options that save Calendar settings.
 *
 * @remarks
 * An accepted save writes the answered status into the shared calendar status. A refusal resolves
 * `{ ok: false }` with the error code and leaves the cache alone.
 */
export function saveCalendarSettingsMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (patch: CalendarSettingsPatch) => putCalendarSettings(patch),
    onSuccess: (result: Awaited<ReturnType<typeof putCalendarSettings>>) => {
      if (result.ok) {
        queryClient.setQueryData(calendarStatusKeys.status, result.value);
      }
    },
  };
}

export function useSaveCalendarSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveCalendarSettingsMutationOptions(queryClient));
}

/**
 * One source's connection behind a connection card: the read, the form error, and the actions.
 *
 * @remarks
 * `startedConnected` freezes the first read of this mount so a card picks its initial open state
 * once and never collapses under the user after that. The request order of every action matches
 * the legacy hook: the call, then one re-read.
 */
export function useSourceConnectionState(source: string) {
  const query = useSourceConnectionQuery(source);
  const saveKey = useSaveSourceKeyMutation(source);
  const connectMutation = useConnectSourceMutation(source);
  const disableMutation = useDisableSourceMutation(source);
  const deleteKey = useDeleteSourceKeyMutation(source);
  const [action, setAction] = useState<CredentialBusy>(null);
  const [formError, setFormError] = useState<SourceKeyError | null>(null);
  const [formProviderError, setFormProviderError] = useState<string | null>(
    null,
  );
  const [started, setStarted] = useState<boolean | null>(null);
  if (started === null && query.isFetchedAfterMount) {
    setStarted(startedConnectedFrom(query.data, query.isError));
  }

  const begin = (next: Exclude<CredentialBusy, "load" | null>) => {
    setAction(next);
    setFormError(null);
    setFormProviderError(null);
  };

  const connect = async (apiKey: string): Promise<boolean> => {
    begin("connect");
    try {
      const result = await saveKey.mutateAsync(apiKey);
      if (!result.ok) {
        setFormError(result.reason);
        setFormProviderError(result.providerError ?? null);
        return false;
      }
      return true;
    } catch {
      setFormError("unreachable");
      return false;
    } finally {
      setAction(null);
    }
  };

  const connectExisting = async (): Promise<void> => {
    begin("connect");
    try {
      const result = await connectMutation.mutateAsync();
      if (!result.ok) {
        setFormError(result.reason);
        setFormProviderError(result.providerError ?? null);
      }
    } catch {
      setFormError("unreachable");
    } finally {
      setAction(null);
    }
  };

  const test = async (): Promise<void> => {
    begin("test");
    await query.refetch();
    setAction(null);
  };

  const disconnect = async (): Promise<void> => {
    begin("disconnect");
    try {
      await deleteKey.mutateAsync();
    } catch {
      setFormError("failed");
    } finally {
      setAction(null);
    }
  };

  const disable = async (): Promise<void> => {
    begin("connect");
    try {
      await disableMutation.mutateAsync();
    } catch {
      setFormError("failed");
    } finally {
      setAction(null);
    }
  };

  return {
    connection: connectionFromRead(query.data, query.isError),
    startedConnected: started,
    busy: action ?? (query.isFetchedAfterMount ? null : "load"),
    formError,
    formProviderError,
    connect,
    connectExisting,
    test,
    disconnect,
    disable,
  };
}
