import { useState } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { parseArchiveRetention } from "../../shared/archive-retention.js";
import { shouldSeedDraft } from "../../shared/draft-seed.js";
import {
  getArchiveRetention,
  saveArchiveRetention,
} from "./archive-retention-api.js";
import { useSingleFlight } from "./single-flight.js";

export const archiveRetentionKeys = {
  all: ["settings", "archive-retention"] as const,
};

export function archiveRetentionQueryOptions() {
  return queryOptions({
    queryKey: archiveRetentionKeys.all,
    queryFn: getArchiveRetention,
  });
}

/**
 * Read the archive retention window, re-reading it on every mount.
 *
 * @remarks
 * Settings shows what the server holds each time it opens, so a cached read from an earlier visit
 * never stands in for it.
 */
export function useArchiveRetentionQuery() {
  return useQuery({
    ...archiveRetentionQueryOptions(),
    refetchOnMount: "always",
  });
}

/**
 * Build the mutation options that save the archive retention window.
 *
 * @remarks
 * An accepted save writes the saved value into the cache. A refusal (400) resolves
 * `{ ok: false }` with the server's message and leaves the cache alone.
 */
export function saveArchiveRetentionMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: saveArchiveRetention,
    onSuccess: (
      result: Awaited<ReturnType<typeof saveArchiveRetention>>,
      days: number,
    ) => {
      if (result.ok) {
        queryClient.setQueryData(archiveRetentionKeys.all, {
          archiveRetentionDays: days,
        });
      }
    },
  };
}

export function useSaveArchiveRetentionMutation() {
  const queryClient = useQueryClient();
  return useMutation(saveArchiveRetentionMutationOptions(queryClient));
}

/**
 * Pick the retention form's save error: the server's message on a refusal, a fixed line on a failed request.
 */
export function retentionSaveErrorText(
  result: Awaited<ReturnType<typeof saveArchiveRetention>> | undefined,
  failed: boolean,
): string | null {
  if (result?.ok === false) return result.error;
  return failed ? "Couldn't save archive retention. Try again." : null;
}

/**
 * Hold the archive retention form: the draft, its parse, and the save with its error text.
 *
 * @remarks
 * The draft follows the server read until the first edit.
 */
export function useArchiveRetentionDraft(onSaved?: () => void) {
  const query = useArchiveRetentionQuery();
  const save = useSaveArchiveRetentionMutation();
  const saveOnce = useSingleFlight(save.mutate);
  const [draft, setDraft] = useState("");
  const [seeded, setSeeded] = useState<typeof query.data>();
  const [edited, setEdited] = useState(false);
  const [saved, setSaved] = useState(false);
  if (query.data && shouldSeedDraft(query.data, seeded, edited)) {
    setSeeded(query.data);
    setDraft(String(query.data.archiveRetentionDays));
  }
  const days = parseArchiveRetention(draft);

  return {
    draft,
    invalid: days === null,
    loadError: query.isError,
    saveErrorText: retentionSaveErrorText(save.data, save.isError),
    saving: save.isPending,
    saved,
    change: (value: string) => {
      setEdited(true);
      setDraft(value);
      setSaved(false);
    },
    save: () => {
      if (days === null) return;
      setSaved(false);
      saveOnce(days, {
        onSuccess: (result) => {
          if (!result.ok) return;
          setSaved(true);
          onSaved?.();
        },
      });
    },
  };
}
