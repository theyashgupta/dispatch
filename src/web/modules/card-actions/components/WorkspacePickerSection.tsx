import type { ComponentProps } from "react";
import type { DiscoveredRepo } from "../../../../shared/types.js";
import type { WorkspaceAdd } from "@/components/WorkspaceAdd";
import { Field } from "@/components/ui/field";
import { FolderPicker } from "./FolderPicker";
import { RepoRow } from "./RepoRow";
import { ModalFieldLabel } from "./ModalFieldLabel";
import { isRepoChecked } from "@/modules/card-actions/domain/workspace-picker";

export interface WorkspacePickerModel {
  folders: string[];
  selectedFolder: string | null;
  repos: DiscoveredRepo[] | null;
  toggles: Record<string, boolean>;
  bases: Record<string, string>;
  browser: ComponentProps<typeof WorkspaceAdd>["browser"];
  onSelectFolder: (path: string) => void;
  onRemoveFolder: (path: string) => void;
  onAddFolder: (path: string) => Promise<string | null>;
  onToggleRepo: (path: string) => void;
  onBaseChange: (path: string, base: string) => void;
}

interface WorkspacePickerSectionProps {
  workspace: WorkspacePickerModel;
}

export function WorkspacePickerSection({
  workspace,
}: WorkspacePickerSectionProps) {
  const { selectedFolder, repos, toggles, bases } = workspace;
  return (
    <div className="flex flex-none flex-col gap-4">
      <FolderPicker
        folders={workspace.folders}
        selected={selectedFolder}
        onSelect={workspace.onSelectFolder}
        onRemove={workspace.onRemoveFolder}
        onAdd={workspace.onAddFolder}
        browser={workspace.browser}
      />
      {selectedFolder !== null && repos !== null && (
        <Field className="gap-1">
          <ModalFieldLabel>Repositories</ModalFieldLabel>
          {repos.length === 0 ? (
            <div className="text-sm leading-(--line-label) font-semibold text-muted-foreground">
              No git repositories found in this folder
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {repos.map((repo) => (
                <RepoRow
                  key={repo.path}
                  repo={repo}
                  checked={isRepoChecked(toggles, repo.path)}
                  base={bases[repo.path] ?? repo.base}
                  onToggle={() => workspace.onToggleRepo(repo.path)}
                  onBaseChange={(base) =>
                    workspace.onBaseChange(repo.path, base)
                  }
                />
              ))}
            </div>
          )}
        </Field>
      )}
    </div>
  );
}
