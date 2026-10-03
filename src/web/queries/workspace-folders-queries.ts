import { useState } from "react";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  addWorkspaceFolder,
  browseDirectory,
  getWorkspaceFolders,
  removeWorkspaceFolder,
} from "./workspace-folders-api.js";

export const workspaceFoldersKeys = {
  all: ["workspaces"] as const,
  folders: ["workspaces", "folders"] as const,
  browse: (path?: string) => ["workspaces", "browse", path ?? null] as const,
};

export function workspaceFoldersQueryOptions() {
  return queryOptions({
    queryKey: workspaceFoldersKeys.folders,
    queryFn: getWorkspaceFolders,
  });
}

export function browseDirectoryQueryOptions(path?: string) {
  return queryOptions({
    queryKey: workspaceFoldersKeys.browse(path),
    queryFn: () => browseDirectory(path),
  });
}

/**
 * Read the registered workspace folders, re-reading them on every mount.
 *
 * @remarks
 * Settings shows the registry as the server holds it each time it opens, so a cached read from an
 * earlier visit never stands in for it.
 */
export function useWorkspaceFoldersQuery() {
  return useQuery({
    ...workspaceFoldersQueryOptions(),
    refetchOnMount: "always",
  });
}

/**
 * List the child folders of a path for the folder browser.
 *
 * @remarks
 * Every listing is read fresh, because a folder can change between two visits and the browser
 * must never show a stale tree. `path` left out lists the home folder.
 */
export function useBrowseDirectoryQuery(
  path: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    ...browseDirectoryQueryOptions(path),
    enabled,
    staleTime: 0,
  });
}

/**
 * Pick the browse target after the folder browser opens or closes.
 *
 * @remarks
 * Opening starts from the home folder. Closing keeps the target so the closing dialog does not
 * record the home folder as the last folder browsed.
 */
export function browseTargetOnOpenChange(
  next: boolean,
  current: string | undefined,
): string | undefined {
  return next ? undefined : current;
}

/**
 * Own the folder browser state and return the props `WorkspaceAdd` takes.
 *
 * @remarks
 * Opening resets the target, so each open lists the home folder first. Closing keeps it, so the
 * closing dialog does not record the home folder as the last folder browsed.
 */
export function useFolderBrowser() {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<string | undefined>();
  const browse = useBrowseDirectoryQuery(target, open);
  return {
    open,
    onOpenChange: (next: boolean) => {
      setTarget((t) => browseTargetOnOpenChange(next, t));
      setOpen(next);
    },
    listing: browse.data,
    loading: browse.isFetching,
    error: browse.isError,
    onNavigate: setTarget,
  };
}

/**
 * Build the mutation options that register a workspace folder.
 *
 * @remarks
 * An accepted add appends the typed path to the cached registry unless it is already there, as the
 * registry list did before. A refusal (400) resolves `{ ok: false }` with the server's message.
 */
export function addWorkspaceFolderMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (path: string) => addWorkspaceFolder(path),
    onSuccess: (
      result: Awaited<ReturnType<typeof addWorkspaceFolder>>,
      path: string,
    ) => {
      if (!result.ok) return;
      queryClient.setQueryData(
        workspaceFoldersKeys.folders,
        (old: Awaited<ReturnType<typeof getWorkspaceFolders>> | undefined) =>
          old && !old.folders.includes(path)
            ? { ...old, folders: [...old.folders, path] }
            : old,
      );
    },
  };
}

export function useAddWorkspaceFolderMutation() {
  const queryClient = useQueryClient();
  return useMutation(addWorkspaceFolderMutationOptions(queryClient));
}

/**
 * Build the mutation options that drop a workspace folder.
 *
 * @remarks
 * The folder leaves the cached registry before the request answers and stays out if the request
 * fails, because the stream snapshot reconciles the registry.
 */
export function removeWorkspaceFolderMutationOptions(queryClient: QueryClient) {
  return {
    mutationFn: (path: string) => removeWorkspaceFolder(path),
    onMutate: (path: string) => {
      queryClient.setQueryData(
        workspaceFoldersKeys.folders,
        (old: Awaited<ReturnType<typeof getWorkspaceFolders>> | undefined) =>
          old && { ...old, folders: old.folders.filter((f) => f !== path) },
      );
    },
  };
}

export function useRemoveWorkspaceFolderMutation() {
  const queryClient = useQueryClient();
  return useMutation(removeWorkspaceFolderMutationOptions(queryClient));
}
