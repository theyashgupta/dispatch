import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  browseDirectory,
  discoverFolder,
  getWorkspaceFolders,
  getWorkspaces,
} from "./workspaces-api.js";

export const workspacesKeys = {
  all: ["workspaces"] as const,
  inventory: (fresh: boolean) => ["workspaces", "inventory", fresh] as const,
  folders: ["workspaces", "folders"] as const,
  discover: (path: string) => ["workspaces", "discover", path] as const,
  browse: (path?: string) => ["workspaces", "browse", path ?? null] as const,
};

/**
 * Reads the inventory.
 *
 * @remarks
 * `fresh` drops the server caches first and is part of the key.
 */
export function workspacesQueryOptions(fresh = false) {
  return queryOptions({
    queryKey: workspacesKeys.inventory(fresh),
    queryFn: () => getWorkspaces(fresh),
  });
}

export function workspaceFoldersQueryOptions() {
  return queryOptions({
    queryKey: workspacesKeys.folders,
    queryFn: getWorkspaceFolders,
  });
}

export function discoverFolderQueryOptions(path: string) {
  return queryOptions({
    queryKey: workspacesKeys.discover(path),
    queryFn: () => discoverFolder(path),
  });
}

export function browseDirectoryQueryOptions(path?: string) {
  return queryOptions({
    queryKey: workspacesKeys.browse(path),
    queryFn: () => browseDirectory(path),
  });
}

export function useWorkspacesQuery(fresh = false) {
  return useQuery(workspacesQueryOptions(fresh));
}
