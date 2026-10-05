import type { ReactNode, RefObject } from "react";
import {
  usePanelRef,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useLocalStorage } from "@/components/ui/hooks/use-local-storage";
import {
  SPLIT_WIDTH_MAX,
  SPLIT_WIDTH_MIN,
  clampSplitWidth,
} from "../../shared/split-width.js";

interface SplitPaneProps {
  list: ReactNode;
  detail: ReactNode;
  only?: "list" | "detail";
}

const PANE = "flex h-full min-h-0 min-w-0 flex-col";

function storeWidthNextFrame(
  panel: RefObject<PanelImperativeHandle | null>,
  store: (width: number) => void,
) {
  requestAnimationFrame(() => {
    if (panel.current) store(clampSplitWidth(panel.current.getSize().inPixels));
  });
}

export function SplitPane({ list, detail, only }: SplitPaneProps) {
  const [width, setWidth] = useLocalStorage("dsp.split.width", clampSplitWidth);
  const listPanel = usePanelRef();

  if (only !== undefined) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className={`${PANE} flex-1`}>
          {only === "list" ? list : detail}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <ResizablePanelGroup
        orientation="horizontal"
        onLayoutChanged={(_, meta) => {
          if (meta.isUserInteraction) storeWidthNextFrame(listPanel, setWidth);
        }}
      >
        <ResizablePanel
          panelRef={listPanel}
          defaultSize={width}
          minSize={SPLIT_WIDTH_MIN}
          maxSize={SPLIT_WIDTH_MAX}
          groupResizeBehavior="preserve-pixel-size"
        >
          <div className={PANE}>{list}</div>
        </ResizablePanel>
        <ResizableHandle className="[transition:var(--hover-transition)] data-[separator=active]:bg-primary data-[separator=hover]:bg-(--hover-resize-handle)" />
        <ResizablePanel minSize={240}>
          <div className={PANE}>{detail}</div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
