import { useEffect, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import {
  pinFromBoard,
  selectedCardOf,
} from "../../../../shared/pinned-card.js";
import type { BoardSnapshot } from "../../../../shared/types.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useLastOpened } from "@/components/ui/hooks/use-last-opened";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { OrcaControls } from "@/modules/workspace/components/OrcaControls";
import { OrcaGroupSection } from "@/modules/workspace/components/OrcaGroupSection";
import { WorkspaceNav } from "@/modules/workspace/components/WorkspaceNav";
import { useStoredChoice } from "@/modules/workspace/hooks/use-stored-choice";
import {
  buildWorkspaceGroups,
  mostRecentCardId,
} from "@/modules/workspace/domain/orca-selectors";
import {
  GROUP_CHOICE,
  readChoice,
  SORT_CHOICE,
  SUBGROUP_CHOICE,
  type StoredChoice,
} from "@/modules/workspace/domain/workspace-choices";

interface WorkspacePageProps {
  board: BoardSnapshot;
  selectedCardId: string | null;
  onSelectCard: (id: string) => void;
}

function readStoredChoice<T extends string>(choice: StoredChoice<T>): T {
  try {
    return readChoice(choice, localStorage.getItem(choice.key));
  } catch {
    return choice.fallback;
  }
}

export function WorkspaceContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useBoardSnapshot(
    useAppStore(appStore, (s) => s.board),
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const selectedId = useAppStore(appStore, (s) => s.selectedCardId);
  const pinned = useAppStore(appStore, (s) => s.pinned);
  if (board == null) return null;
  return (
    <WorkspacePage
      board={board}
      selectedCardId={
        selectedCardOf(board.cards, selectedId, pinned) != null
          ? selectedId
          : null
      }
      onSelectCard={(id) =>
        appStore.selectCard(id, pinFromBoard(id, board.cards))
      }
    />
  );
}

function WorkspacePage({
  board,
  selectedCardId,
  onSelectCard,
}: WorkspacePageProps) {
  const [group, setGroup] = useState(() => readStoredChoice(GROUP_CHOICE));
  const [subgroup, setSubgroup] = useState(() =>
    readStoredChoice(SUBGROUP_CHOICE),
  );
  const [sort, setSort] = useState(() => readStoredChoice(SORT_CHOICE));
  const lastOpened = useLastOpened();

  useEffect(() => {
    if (selectedCardId != null) return;
    const id = mostRecentCardId(lastOpened, board.cards);
    if (id != null) onSelectCard(id);
  }, [selectedCardId, board.cards, lastOpened, onSelectCard]);

  useStoredChoice(GROUP_CHOICE.key, group);
  useStoredChoice(SUBGROUP_CHOICE.key, subgroup);
  useStoredChoice(SORT_CHOICE.key, sort);

  const groups = buildWorkspaceGroups(board.cards, group, subgroup, sort);

  return (
    <WorkspaceNav
      controls={
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
      }
      empty={groups.length === 0}
    >
      {groups.map((sectionGroup) => (
        <OrcaGroupSection
          key={sectionGroup.key}
          dimension={group}
          group={sectionGroup}
          selectedCardId={selectedCardId}
          onSelectCard={onSelectCard}
        />
      ))}
    </WorkspaceNav>
  );
}
