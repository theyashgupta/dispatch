import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { TERMINAL_APPEARANCE_CHANNEL } from "../../../../shared/terminal-appearance.js";
import type {
  TerminalAppearance,
  UserProfile,
} from "../../../../shared/types.js";
import {
  disablePush,
  disableRemote,
  enablePush,
  enableRemote,
  getCleanupDelay,
  getClaudeArgs,
  getProfile,
  getTerminalAppearance,
  isIOSDevice,
  readPushSubscription,
  saveClaudeArgs,
  saveCleanupDelay,
  saveProfile,
  saveTerminalAppearance,
} from "./settings-api.js";
import { isPushSupported } from "@/queries/push-api";

export const settingsKeys = {
  all: ["settings"] as const,
  cleanupDelay: ["settings", "cleanup-delay"] as const,
  terminal: ["settings", "terminal"] as const,
  claudeArgs: ["settings", "claude-args"] as const,
  linearStateMap: ["settings", "linear-state-map"] as const,
  profile: ["settings", "profile"] as const,
  archiveRetention: ["settings", "archive-retention"] as const,
  pushSubscription: ["settings", "push-subscription"] as const,
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

export function profileQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.profile,
    queryFn: getProfile,
  });
}

/**
 * Read whether this browser holds a push subscription, without prompting.
 *
 * @remarks
 * The query answers a boolean because a `PushSubscription` is a live browser object that does not
 * belong in a cache. The read never registers a worker or asks for permission.
 */
export function pushSubscriptionQueryOptions() {
  return queryOptions({
    queryKey: settingsKeys.pushSubscription,
    queryFn: async () => (await readPushSubscription()) != null,
  });
}

/**
 * Read a setting, re-reading it on every mount.
 *
 * @remarks
 * Settings shows what the server holds each time it opens, so a cached read from an earlier visit
 * never stands in for it.
 */
export function useCleanupDelayQuery() {
  return useQuery({ ...cleanupDelayQueryOptions(), refetchOnMount: "always" });
}

export function useClaudeArgsQuery() {
  return useQuery({ ...claudeArgsQueryOptions(), refetchOnMount: "always" });
}

export function useTerminalAppearanceQuery() {
  return useQuery({
    ...terminalAppearanceQueryOptions(),
    refetchOnMount: "always",
  });
}

export function useProfileQuery() {
  return useQuery({ ...profileQueryOptions(), refetchOnMount: "always" });
}

export function usePushSubscriptionQuery() {
  return useQuery({
    ...pushSubscriptionQueryOptions(),
    refetchOnMount: "always",
  });
}

/**
 * Report what this browser can do about push.
 *
 * @remarks
 * Both answers come from the browser, not the server, so they are plain reads and not queries.
 */
export function readPushEnvironment(): { supported: boolean; ios: boolean } {
  return { supported: isPushSupported(), ios: isIOSDevice() };
}

/**
 * Build the mutation options that save the cleanup delay.
 *
 * @remarks
 * An accepted save writes the saved value into the cache. A refusal (400) resolves `{ ok: false }`
 * and leaves the cache alone.
 */
export function saveCleanupDelayMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (days: number) => saveCleanupDelay(days),
    onSuccess: (
      result: Awaited<ReturnType<typeof saveCleanupDelay>>,
      days: number,
    ) => {
      if (result.ok) {
        queryClient.setQueryData(settingsKeys.cleanupDelay, {
          cleanupDelayDays: days,
        });
      }
    },
  };
}

export function useSaveCleanupDelayMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveCleanupDelayMutationOptions(queryClient));
}

/**
 * Build the mutation options that save the `claude` launch arguments.
 *
 * @remarks
 * An accepted save writes the saved text into the cache. A refusal resolves `{ ok: false }`.
 */
export function saveClaudeArgsMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (claudeArgs: string) => saveClaudeArgs(claudeArgs),
    onSuccess: (
      result: Awaited<ReturnType<typeof saveClaudeArgs>>,
      claudeArgs: string,
    ) => {
      if (result.ok) {
        queryClient.setQueryData(settingsKeys.claudeArgs, { claudeArgs });
      }
    },
  };
}

export function useSaveClaudeArgsMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveClaudeArgsMutationOptions(queryClient));
}

/**
 * Build the mutation options that save the terminal appearance.
 *
 * @remarks
 * An accepted save writes the saved appearance into the cache and tells the open terminals through
 * the broadcast channel. A refusal resolves `{ ok: false }` with the server's field-named message.
 */
export function saveTerminalAppearanceMutationOptions(
  queryClient: QueryClient,
) {
  return {
    mutationFn: (appearance: TerminalAppearance) =>
      saveTerminalAppearance(appearance),
    onSuccess: (
      result: Awaited<ReturnType<typeof saveTerminalAppearance>>,
      appearance: TerminalAppearance,
    ) => {
      if (!result.ok) return;
      queryClient.setQueryData(settingsKeys.terminal, appearance);
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel(TERMINAL_APPEARANCE_CHANNEL);
        channel.postMessage(appearance);
        channel.close();
      }
    },
  };
}

export function useSaveTerminalAppearanceMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveTerminalAppearanceMutationOptions(queryClient));
}

/**
 * Build the mutation options that save the About you profile.
 *
 * @remarks
 * An accepted save writes the profile the server stored into the cache, because the server
 * normalizes it. A refusal resolves `{ ok: false }` with the field-named message.
 */
export function saveProfileMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (profile: UserProfile) => saveProfile(profile),
    onSuccess: (result: Awaited<ReturnType<typeof saveProfile>>) => {
      if (result.ok) {
        queryClient.setQueryData(settingsKeys.profile, result.profile);
      }
    },
  };
}

export function useSaveProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveProfileMutationOptions(queryClient));
}

export const enableRemoteMutationOptions = { mutationFn: enableRemote };

export const disableRemoteMutationOptions = { mutationFn: disableRemote };

/**
 * Enable remote access.
 *
 * @remarks
 * The authoritative tunnel state arrives over the stream, not this response.
 */
export function useEnableRemoteMutation() {
  return useMutation(enableRemoteMutationOptions);
}

export function useDisableRemoteMutation() {
  return useMutation(disableRemoteMutationOptions);
}

function rereadPushSubscription(queryClient: QueryClient): Promise<void> {
  return queryClient.refetchQueries({
    queryKey: settingsKeys.pushSubscription,
    exact: true,
  });
}

/**
 * Build the mutation options that subscribe this device to push.
 *
 * @remarks
 * The subscription is re-read whether the attempt worked or not, so the row shows what the
 * browser holds. The attempt never rejects: a failure resolves `{ ok: false }`.
 */
export function enablePushMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: () => enablePush(),
    onSettled: () => rereadPushSubscription(queryClient),
  };
}

export function useEnablePushMutation() {
  const queryClient = useQueryClient();
  return useMutation(enablePushMutationOptions(queryClient));
}

/**
 * Build the mutation options that unsubscribe this device from push.
 *
 * @remarks
 * The subscription is re-read whether the attempt worked or not. The attempt resolves `false` on
 * failure instead of rejecting.
 */
export function disablePushMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: () => disablePush(),
    onSettled: () => rereadPushSubscription(queryClient),
  };
}

export function useDisablePushMutation() {
  const queryClient = useQueryClient();
  return useMutation(disablePushMutationOptions(queryClient));
}
