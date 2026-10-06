import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  GroupDimension,
  SortKey,
  SubgroupDimension,
} from "@/modules/workspace/domain/orca-selectors";

interface OrcaControlsProps {
  group: GroupDimension;
  subgroup: SubgroupDimension;
  sort: SortKey;
  onChangeGroup: (group: GroupDimension) => void;
  onChangeSubgroup: (subgroup: SubgroupDimension) => void;
  onChangeSort: (sort: SortKey) => void;
}

const SUBGROUP_LABEL: Record<SubgroupDimension, string> = {
  none: "None",
  status: "Status",
  workspace: "Workspace",
};

const TRIGGER_CLASS =
  "min-w-0 flex-auto data-[size=sm]:h-6.5 px-1 py-0 rounded-md";
const LABEL_CLASS =
  "w-15 flex-none text-sm font-semibold text-muted-foreground";

export function OrcaControls({
  group,
  subgroup,
  sort,
  onChangeGroup,
  onChangeSubgroup,
  onChangeSort,
}: OrcaControlsProps) {
  const subgroupOptions: SubgroupDimension[] = (
    ["none", "status", "workspace"] as const
  ).filter((option) => option === "none" || option !== group);

  return (
    <div className="flex flex-none flex-col gap-1 border-b border-border px-4 py-2">
      <div className="flex items-center gap-1">
        <span className={LABEL_CLASS}>Group</span>
        <Select
          value={group}
          onValueChange={(value) => onChangeGroup(value as GroupDimension)}
        >
          <SelectTrigger
            size="sm"
            variant="surface"
            aria-label="Group by"
            className={TRIGGER_CLASS}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="workspace">Workspace</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <span className={LABEL_CLASS}>Subgroup</span>
        <Select
          value={subgroup}
          onValueChange={(value) =>
            onChangeSubgroup(value as SubgroupDimension)
          }
        >
          <SelectTrigger
            size="sm"
            variant="surface"
            aria-label="Subgroup by"
            className={TRIGGER_CLASS}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {subgroupOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {SUBGROUP_LABEL[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <span className={LABEL_CLASS}>Sort</span>
        <Select
          value={sort}
          onValueChange={(value) => onChangeSort(value as SortKey)}
        >
          <SelectTrigger
            size="sm"
            variant="surface"
            aria-label="Sort by"
            className={TRIGGER_CLASS}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="id">ID</SelectItem>
            <SelectItem value="title">Title</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
