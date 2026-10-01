import type { ComponentProps } from "react";
import { FolderGit2, Trash2 } from "lucide-react";
import { WorkspaceAdd } from "@/components/WorkspaceAdd";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Item, ItemContent, ItemMedia } from "@/components/ui/item";

interface WorkspacesSectionProps {
  folders: string[];
  loading: boolean;
  loadError: boolean;
  browser: ComponentProps<typeof WorkspaceAdd>["browser"];
  onAdd: (path: string) => Promise<string | null>;
  onRemove: (path: string) => void;
}

export function WorkspacesSection({
  folders,
  loading,
  loadError,
  browser,
  onAdd,
  onRemove,
}: WorkspacesSectionProps) {
  return (
    <>
      <WorkspaceAdd
        onAdd={onAdd}
        browser={browser}
        hint="Add a folder that contains the git repos you start tickets in."
      />

      {loading && (
        <span className="text-sm font-semibold text-muted-foreground">
          Loading…
        </span>
      )}

      {!loading && loadError && (
        <Alert variant="destructive">
          <AlertDescription className="font-semibold">
            Couldn't load workspaces. Reopen settings to retry.
          </AlertDescription>
        </Alert>
      )}

      {!loading && !loadError && folders.length === 0 && (
        <Alert variant="muted" role="status" className="mt-4">
          <AlertTitle>No workspaces yet</AlertTitle>
          <AlertDescription>
            Add a folder above to start tickets in it.
          </AlertDescription>
        </Alert>
      )}

      {!loading && !loadError && folders.length > 0 && (
        <div className="flex flex-col">
          {folders.map((path) => (
            <Item
              key={path}
              size="sm"
              className="flex-nowrap gap-2 p-2 hover:bg-accent"
            >
              <ItemMedia>
                <FolderGit2
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <span className="truncate font-mono text-sm font-semibold text-foreground">
                  {path}
                </span>
              </ItemContent>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={`Remove workspace ${path}`}
                onClick={() => onRemove(path)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </Item>
          ))}
        </div>
      )}
    </>
  );
}
