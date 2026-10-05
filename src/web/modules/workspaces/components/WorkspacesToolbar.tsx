import { LoadingButton } from "@/components/LoadingButton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  WORKTREE_SORT_LABELS,
  type WorktreeSortKey,
} from "@/modules/workspaces/domain/workspace-rows";

interface WorkspacesToolbarProps {
  sortKey: WorktreeSortKey;
  loading: boolean;
  onSortChange: (key: WorktreeSortKey) => void;
  onRefresh: () => void;
}

export function WorkspacesToolbar({
  sortKey,
  loading,
  onSortChange,
  onRefresh,
}: WorkspacesToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={sortKey}
        onValueChange={(value) => onSortChange(value as WorktreeSortKey)}
      >
        <SelectTrigger size="sm" aria-label="Sort by">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(WORKTREE_SORT_LABELS) as WorktreeSortKey[]).map(
            (key) => (
              <SelectItem key={key} value={key}>
                {WORKTREE_SORT_LABELS[key]}
              </SelectItem>
            ),
          )}
        </SelectContent>
      </Select>
      <LoadingButton variant="secondary" loading={loading} onClick={onRefresh}>
        Refresh
      </LoadingButton>
    </div>
  );
}
