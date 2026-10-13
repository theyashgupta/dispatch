import { useLayoutEffect, useState } from "react";
import { elbowPath } from "@/modules/orchestrator/domain/centre-edges";

export interface EdgePath {
  to: string;
  d: string;
}

/**
 * Measure the node and the tiles inside a container and give one elbow path per tile.
 *
 * @remarks The container is a callback ref held in state, so the effect runs once it mounts. The node carries `data-edge-node` and each tile carries `data-edge-tile` with its id. A resize of the container or of any tile, such as an inline reply that opens, measures again.
 */
export function useEdgePaths(tileIds: readonly string[]) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [paths, setPaths] = useState<EdgePath[]>([]);
  const key = tileIds.join("\n");

  useLayoutEffect(() => {
    if (root === null) return;
    const measure = () => {
      const base = root.getBoundingClientRect();
      const node = root.querySelector("[data-edge-node]");
      if (node === null) return;
      const nodeBox = node.getBoundingClientRect();
      const from = {
        x: nodeBox.right - base.left,
        y: nodeBox.top + nodeBox.height / 2 - base.top,
      };
      const next: EdgePath[] = [];
      for (const tile of root.querySelectorAll("[data-edge-tile]")) {
        const to = tile.getAttribute("data-edge-tile");
        if (to === null) continue;
        const box = tile.getBoundingClientRect();
        next.push({
          to,
          d: elbowPath(from, {
            x: box.left - base.left,
            y: box.top + box.height / 2 - base.top,
          }),
        });
      }
      setPaths((prev) =>
        JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const el of root.querySelectorAll("[data-edge-tile]")) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [root, key]);

  return { container: setRoot, paths };
}
