import { useLayoutEffect, useState } from "react";
import {
  elbowPath,
  pickSource,
} from "@/modules/orchestrator/domain/centre-edges";

export interface EdgePath {
  to: string;
  d: string;
}

/**
 * Measure the node and the tiles inside a container and give one elbow path per tile.
 *
 * @remarks The container is a callback ref held in state, so the effect runs once it mounts. Each node carries `data-edge-node` with its name, and each tile carries `data-edge-tile` with its id and an optional `data-edge-from` that names its node. A resize of the container or of any tile or node, such as an inline reply that opens, measures again.
 */
export function useEdgePaths(tileIds: readonly string[]) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [paths, setPaths] = useState<EdgePath[]>([]);
  const key = tileIds.join("\n");

  useLayoutEffect(() => {
    if (root === null) return;
    const measure = () => {
      const base = root.getBoundingClientRect();
      const sources = new Map<string, { x: number; y: number }>();
      for (const node of root.querySelectorAll("[data-edge-node]")) {
        const nodeBox = node.getBoundingClientRect();
        sources.set(node.getAttribute("data-edge-node") ?? "", {
          x: nodeBox.right - base.left,
          y: nodeBox.top + nodeBox.height / 2 - base.top,
        });
      }
      if (sources.size === 0) return;
      const next: EdgePath[] = [];
      for (const tile of root.querySelectorAll("[data-edge-tile]")) {
        const to = tile.getAttribute("data-edge-tile");
        if (to === null) continue;
        const from = pickSource(tile.getAttribute("data-edge-from"), sources);
        if (from === null) continue;
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
    for (const el of root.querySelectorAll(
      "[data-edge-tile], [data-edge-node]",
    )) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [root, key]);

  return { container: setRoot, paths };
}
