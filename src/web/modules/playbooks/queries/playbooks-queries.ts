import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  createPlaybook,
  deletePlaybook,
  generatePlaybookDraft,
  getPlaybooks,
  updatePlaybook,
  type PlaybookWriteInput,
} from "./playbooks-api.js";

export const playbooksKeys = {
  all: ["playbooks"] as const,
  list: ["playbooks", "list"] as const,
};

/**
 * Read the playbooks fresh on every page open, and drop it once the page closes.
 *
 * @remarks
 * The legacy page read on mount and showed nothing until the read answered; a cached list would show
 * rows that a write made elsewhere (an unwind, an undo, another tab) already removed.
 */
export function playbooksQueryOptions() {
  return queryOptions({
    queryKey: playbooksKeys.list,
    queryFn: getPlaybooks,
    gcTime: 0,
  });
}

export function usePlaybooksQuery() {
  return useQuery(playbooksQueryOptions());
}

/**
 * Build the mutation options that create a playbook.
 *
 * @remarks
 * A created playbook marks the list stale so it reloads. A `name-exists` or `footgun` refusal
 * resolves `{ ok: false }` and leaves the cache alone.
 */
export function createPlaybookMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: createPlaybook,
    onSuccess: (result: Awaited<ReturnType<typeof createPlaybook>>) => {
      if (result.ok) {
        return queryClient.invalidateQueries({ queryKey: playbooksKeys.list });
      }
    },
  };
}

export function useCreatePlaybookMutation() {
  const queryClient = useQueryClient();
  return useMutation(createPlaybookMutationOptions(queryClient));
}

/**
 * Build the mutation options that rename or edit a playbook.
 *
 * @remarks
 * A saved edit marks the list stale so it reloads. A refusal resolves `{ ok: false }` and leaves
 * the cache alone.
 */
export function updatePlaybookMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (vars: { slug: string; input: PlaybookWriteInput }) =>
      updatePlaybook(vars.slug, vars.input),
    onSuccess: (result: Awaited<ReturnType<typeof updatePlaybook>>) => {
      if (result.ok) {
        return queryClient.invalidateQueries({ queryKey: playbooksKeys.list });
      }
    },
  };
}

export function useUpdatePlaybookMutation() {
  const queryClient = useQueryClient();
  return useMutation(updatePlaybookMutationOptions(queryClient));
}

/**
 * Build the mutation options that delete a playbook.
 *
 * @remarks
 * A delete marks the list stale so it reloads. A refused delete resolves `{ ok: false }`.
 */
export function deletePlaybookMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: deletePlaybook,
    onSuccess: (result: Awaited<ReturnType<typeof deletePlaybook>>) => {
      if (result.ok) {
        return queryClient.invalidateQueries({ queryKey: playbooksKeys.list });
      }
    },
  };
}

export function useDeletePlaybookMutation() {
  const queryClient = useQueryClient();
  return useMutation(deletePlaybookMutationOptions(queryClient));
}

/**
 * Build the mutation options that draft a playbook.
 *
 * @remarks
 * A draft is text for the editor, so it never touches the cache. A failure resolves `{ ok: false }`.
 */
export const generatePlaybookDraftMutationOptions = {
  mutationFn: generatePlaybookDraft,
};

export function useGeneratePlaybookDraftMutation() {
  return useMutation(generatePlaybookDraftMutationOptions);
}
