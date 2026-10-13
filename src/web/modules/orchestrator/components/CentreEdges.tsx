import type { CentreEdge } from "@/modules/orchestrator/domain/centre-graph";
import type { EdgePath } from "@/modules/orchestrator/hooks/use-edge-paths";

interface CentreEdgesProps {
  edges: readonly CentreEdge[];
  paths: readonly EdgePath[];
}

export function CentreEdges({ edges, paths }: CentreEdgesProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      {edges.map((edge) => {
        const path = paths.find((p) => p.to === edge.to);
        return path === undefined ? null : (
          <path
            key={edge.to}
            d={path.d}
            fill="none"
            strokeWidth={1.5}
            strokeDasharray={edge.dashed ? "4 4" : undefined}
            className="stroke-(--border-strong)"
          />
        );
      })}
    </svg>
  );
}
