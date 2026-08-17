import type { CSSProperties } from "react";
import { Field } from "../../primitives/Field.js";
import type {
  GroupDimension,
  SortKey,
  SubgroupDimension,
} from "./orca-selectors.js";

interface OrcaControlsProps {
  group: GroupDimension;
  subgroup: SubgroupDimension;
  sort: SortKey;
  onChangeGroup: (group: GroupDimension) => void;
  onChangeSubgroup: (subgroup: SubgroupDimension) => void;
  onChangeSort: (sort: SortKey) => void;
}

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
};

const labelStyle: CSSProperties = {
  flex: "0 0 60px",
};

const selectStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  height: "26px",
  padding: "0 var(--space-xs)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  outline: "none",
};

const SUBGROUP_LABEL: Record<SubgroupDimension, string> = {
  none: "None",
  status: "Status",
  workspace: "Workspace",
};

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
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
        padding: "var(--space-sm) var(--space-lg)",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={rowStyle}>
        <Field style={labelStyle}>Group</Field>
        <select
          aria-label="Group by"
          value={group}
          onChange={(e) => onChangeGroup(e.target.value as GroupDimension)}
          style={selectStyle}
        >
          <option value="status">Status</option>
          <option value="workspace">Workspace</option>
        </select>
      </div>
      <div style={rowStyle}>
        <Field style={labelStyle}>Subgroup</Field>
        <select
          aria-label="Subgroup by"
          value={subgroup}
          onChange={(e) =>
            onChangeSubgroup(e.target.value as SubgroupDimension)
          }
          style={selectStyle}
        >
          {subgroupOptions.map((option) => (
            <option key={option} value={option}>
              {SUBGROUP_LABEL[option]}
            </option>
          ))}
        </select>
      </div>
      <div style={rowStyle}>
        <Field style={labelStyle}>Sort</Field>
        <select
          aria-label="Sort by"
          value={sort}
          onChange={(e) => onChangeSort(e.target.value as SortKey)}
          style={selectStyle}
        >
          <option value="id">ID</option>
          <option value="title">Title</option>
        </select>
      </div>
    </div>
  );
}
