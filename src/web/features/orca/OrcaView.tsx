import { useEffect, useState } from "react";
import type { BoardSnapshot } from "../../../shared/types.js";
import { OrcaControls } from "./OrcaControls.js";
import { OrcaGroupSection } from "./OrcaGroupSection.js";
import {
  buildWorkspaceGroups,
  type GroupDimension,
  type SortKey,
  type SubgroupDimension,
} from "./orca-selectors.js";

interface OrcaViewProps {
  board: BoardSnapshot;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
}

function readStoredGroup(): GroupDimension {
  try {
    return localStorage.getItem("dsp.workspaceGroup") === "workspace"
      ? "workspace"
      : "status";
  } catch {
    return "status";
  }
}

function readStoredSubgroup(): SubgroupDimension {
  try {
    const stored = localStorage.getItem("dsp.workspaceSubgroup");
    return stored === "status" || stored === "workspace" ? stored : "none";
  } catch {
    return "none";
  }
}

function readStoredSort(): SortKey {
  try {
    return localStorage.getItem("dsp.workspaceSort") === "title"
      ? "title"
      : "id";
  } catch {
    return "id";
  }
}

export function OrcaView({
  board,
  selectedCardId,
  onSelectCard,
}: OrcaViewProps) {
  const [group, setGroup] = useState<GroupDimension>(readStoredGroup);
  const [subgroup, setSubgroup] =
    useState<SubgroupDimension>(readStoredSubgroup);
  const [sort, setSort] = useState<SortKey>(readStoredSort);

  useEffect(() => {
    try {
      localStorage.setItem("dsp.workspaceGroup", group);
    } catch {}
  }, [group]);

  useEffect(() => {
    try {
      localStorage.setItem("dsp.workspaceSubgroup", subgroup);
    } catch {}
  }, [subgroup]);

  useEffect(() => {
    try {
      localStorage.setItem("dsp.workspaceSort", sort);
    } catch {}
  }, [sort]);

  const groups = buildWorkspaceGroups(board.cards, group, subgroup, sort);

  return (
    <div style={{ flex: "1 1 auto", minHeight: 0, display: "flex" }}>
      <nav
        aria-label="Tickets"
        style={{
          width: "var(--orca-nav-width)",
          flex: "0 0 auto",
          minHeight: 0,
          borderRight: "1px solid var(--border)",
          background: "var(--surface-column)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <OrcaControls
          group={group}
          subgroup={subgroup}
          sort={sort}
          onChangeGroup={(next) => {
            setGroup(next);
            if (subgroup === next) setSubgroup("none");
          }}
          onChangeSubgroup={setSubgroup}
          onChangeSort={setSort}
        />
        <div
          className="scroll-stable-y"
          style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
        >
          {groups.length === 0 ? (
            <div
              style={{
                padding: "var(--space-lg)",
                textAlign: "center",
                fontSize: "var(--font-label)",
                fontWeight: "var(--weight-regular)",
                color: "var(--text-muted)",
              }}
            >
              No tickets.
            </div>
          ) : (
            groups.map((sectionGroup) => (
              <OrcaGroupSection
                key={sectionGroup.key}
                dimension={group}
                group={sectionGroup}
                selectedCardId={selectedCardId}
                onSelectCard={onSelectCard}
              />
            ))
          )}
        </div>
      </nav>
    </div>
  );
}
