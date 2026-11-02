import { useEffect } from "react";
import {
  useNavigate,
  useParams,
  useRouteContext,
  useSearch,
} from "@tanstack/react-router";
import {
  firstOtherBoard,
  splitLayout,
  type SplitDirection,
} from "../../../../shared/board-split.js";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import type { BoardKey } from "../../../../shared/types.js";
import { RESIZE_HANDLE_CLASS } from "@/components/SplitPane";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useLocalStorage } from "@/components/ui/hooks/use-local-storage";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { BoardPane } from "@/modules/board/components/BoardPane";
import { SplitButton } from "@/modules/board/components/SplitButton";
import { SplitPaneHeader } from "@/modules/board/components/SplitPaneHeader";
import { BoardContainer } from "@/modules/board/containers/BoardContainer";
import { SearchContainer } from "@/modules/board/containers/SearchContainer";
import { parseSplitSizes } from "@/modules/board/domain/split-sizes";
import { useBoardListQuery } from "@/queries/board-list-queries";

const MIN_PANE_PX = { row: 360, column: 240 };

export function BoardSplitContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const { key } = useParams({ from: "/boards/$key/" });
  const search = useSearch({ from: "/boards/$key/" });
  const primary = key as BoardKey;
  const boards = useBoardListQuery().data?.boards;
  const wide = !useMediaQuery(CAROUSEL_QUERY);
  const layout = splitLayout({
    primary,
    split: search.split,
    dir: search.dir,
    wide,
    boards,
  });
  const secondary = layout.mode === "split" ? layout.secondary : null;
  const activeBoard = useAppStore(appStore, (s) => s.activeBoard);
  const [rowSizes, setRowSizes] = useLocalStorage(
    "dsp.split.board.row",
    parseSplitSizes,
  );
  const [columnSizes, setColumnSizes] = useLocalStorage(
    "dsp.split.board.column",
    parseSplitSizes,
  );

  useEffect(() => {
    appStore.setSplit(secondary);
  }, [appStore, secondary]);
  useEffect(() => () => appStore.setSplit(null), [appStore]);

  const goTo = (to: BoardKey, split?: BoardKey, dir?: SplitDirection) =>
    void navigate({
      to: "/boards/$key",
      params: { key: to },
      search: (prev) => ({
        ...prev,
        split,
        dir: split === undefined ? undefined : dir,
      }),
    });

  if (layout.mode === "single") {
    if (search.split !== undefined && wide && boards === undefined) {
      return null;
    }
    const other = wide ? firstOtherBoard(primary, boards) : null;
    return (
      <BoardContainer
        search={<SearchContainer />}
        actions={
          wide ? (
            <SplitButton
              available={other !== null}
              onSplit={() => {
                if (other !== null) goTo(primary, other, "row");
              }}
            />
          ) : undefined
        }
      />
    );
  }

  const { dir } = layout;
  const nameOf = (boardKey: BoardKey) =>
    boards?.find((board) => board.key === boardKey)?.name ?? boardKey;
  const options = (boards ?? []).filter(
    (board) => !board.archived && board.key !== primary,
  );
  const secondaryActive = activeBoard === layout.secondary;
  const sizes = dir === "row" ? rowSizes : columnSizes;
  const storeSizes = dir === "row" ? setRowSizes : setColumnSizes;
  const min = MIN_PANE_PX[dir];

  const pane = (which: "primary" | "secondary") => {
    const boardKey = which === "primary" ? primary : layout.secondary;
    const paneBoard = which === "primary" ? undefined : boardKey;
    const isActive = (which === "secondary") === secondaryActive;
    const activate = () => appStore.setActiveBoard(paneBoard ?? null);
    return (
      <BoardPane
        active={isActive}
        onActivate={activate}
        header={
          <SplitPaneHeader
            boardName={nameOf(boardKey)}
            onClose={() =>
              goTo(which === "primary" ? layout.secondary : primary)
            }
            secondary={
              paneBoard === undefined
                ? undefined
                : {
                    value: paneBoard,
                    options,
                    onValueChange: (next) => {
                      appStore.setActiveBoard(next);
                      goTo(primary, next, dir);
                    },
                    dir,
                    onDirChange: (next) => goTo(primary, paneBoard, next),
                  }
            }
          />
        }
      >
        <BoardContainer
          key={boardKey}
          boardKey={paneBoard}
          pane={which}
          active={isActive}
          search={<SearchContainer boardKey={paneBoard} />}
        />
      </BoardPane>
    );
  };

  return (
    <ResizablePanelGroup
      key={dir}
      className="min-h-0 min-w-0 flex-1"
      orientation={dir === "row" ? "horizontal" : "vertical"}
      defaultLayout={sizes}
      onLayoutChanged={(next, meta) => {
        if (meta.isUserInteraction) storeSizes(parseSplitSizes(next));
      }}
    >
      <ResizablePanel id="primary" defaultSize="50%" minSize={min}>
        {pane("primary")}
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize boards"
        className={RESIZE_HANDLE_CLASS}
      />
      <ResizablePanel id="secondary" defaultSize="50%" minSize={min}>
        {pane("secondary")}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
