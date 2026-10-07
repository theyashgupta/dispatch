import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Badge } from "@/components/ui/badge";
import { useCssVars } from "@/components/ui/hooks/use-css-vars";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { cn } from "@/lib/utils";

interface FlowNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  children: ReactNode;
}

interface FlowEdge {
  id: string;
  path: string;
  tone?: string;
  dim?: boolean;
}

export interface FlowToken {
  id: string;
  path: string;
  color: string;
  durationMs: number;
  loop?: boolean;
}

interface FlowStageProps {
  width: number;
  height: number;
  nodes: readonly FlowNode[];
  edges: readonly FlowEdge[];
  tokens?: readonly FlowToken[];
  onTokenEnd?: (id: string) => void;
  ariaLabel: string;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

const DIM_OPACITY = 0.45;

export function FlowStage({
  width,
  height,
  nodes,
  edges,
  tokens = [],
  onTokenEnd,
  ariaLabel,
}: FlowStageProps) {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const reduced = useMediaQuery(REDUCED_MOTION);
  const setStageVars = useCssVars({
    "--stage-w": `${width}px`,
    "--stage-h": `${height}px`,
    "--stage-scale": String(scale),
  });
  const attachOuter = useCallback(
    (element: HTMLDivElement | null) => {
      outerRef.current = element;
      setStageVars(element);
    },
    [setStageVars],
  );

  useEffect(() => {
    const el = outerRef.current;
    if (el == null) return;
    const observer = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width]);

  useEffect(() => {
    if (!reduced || onTokenEnd == null) return;
    for (const token of tokens) onTokenEnd(token.id);
  }, [reduced, tokens, onTokenEnd]);

  return (
    <div
      ref={attachOuter}
      role="group"
      aria-label={ariaLabel}
      className="h-[calc(var(--stage-h)*var(--stage-scale))] w-full max-w-(--stage-w) overflow-hidden"
    >
      <div className="relative h-(--stage-h) w-(--stage-w) origin-top-left [transform:scale(var(--stage-scale))]">
        <svg
          aria-hidden="true"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="absolute inset-0 overflow-visible"
        >
          {edges.map((edge) => (
            <path
              key={edge.id}
              d={edge.path}
              fill="none"
              stroke={edge.tone ?? "var(--text-muted)"}
              strokeWidth={1.5}
              opacity={edge.dim ? DIM_OPACITY : 1}
            />
          ))}
        </svg>
        {nodes.map((node) => (
          <StageNode key={node.id} node={node} />
        ))}
        {!reduced &&
          tokens.map((token) => (
            <StageToken key={token.id} token={token} onEnd={onTokenEnd} />
          ))}
      </div>
    </div>
  );
}

function StageNode({ node }: { node: FlowNode }) {
  const vars = useCssVars({
    "--x": `${node.x}px`,
    "--y": `${node.y}px`,
    "--w": `${node.w}px`,
    "--h": `${node.h}px`,
  });
  return (
    <div ref={vars} className="absolute top-(--y) left-(--x) h-(--h) w-(--w)">
      {node.children}
    </div>
  );
}

interface StageTokenProps {
  token: FlowToken;
  onEnd?: (id: string) => void;
}

function StageToken({ token, onEnd }: StageTokenProps) {
  const vars = useCssVars({
    "--token-path": `path("${token.path}")`,
    "--token-ms": `${token.durationMs}ms`,
  });
  return (
    <span
      data-flow-token=""
      aria-hidden="true"
      ref={vars}
      onAnimationEnd={() => onEnd?.(token.id)}
      className={cn(
        "pointer-events-none absolute top-0 left-0 [offset-path:var(--token-path)] [offset-rotate:0deg]",
        token.loop
          ? "animate-[flow-travel_var(--token-ms)_linear_infinite]"
          : "animate-[flow-travel_var(--token-ms)_linear_forwards]",
      )}
    >
      <FlowChip color={token.color} />
    </span>
  );
}

interface FlowBoxProps {
  accent?: string;
  tone?: string;
  dim?: boolean;
  onClick?: () => void;
  ariaLabel?: string;
  children: ReactNode;
}

const BOX_CLASS =
  "flex size-full flex-col justify-center gap-(--space-xs) overflow-hidden rounded-md border border-(color:--box-tone) bg-card px-(--space-sm) py-(--space-xs) text-left font-sans text-sm text-foreground";

export function FlowBox({
  accent,
  tone = "var(--border)",
  dim,
  onClick,
  ariaLabel,
  children,
}: FlowBoxProps) {
  const className = cn(
    BOX_CLASS,
    accent !== undefined && "border-l-3 border-l-(color:--box-accent)",
    dim &&
      "border-(color:--box-tone)/45 text-muted-foreground [&_svg]:opacity-45",
    dim && accent !== undefined && "border-l-(color:--box-accent)/45",
  );
  const vars = useCssVars({
    "--box-tone": tone,
    "--box-accent": accent,
  });
  if (onClick == null) {
    return (
      <div
        ref={vars}
        role={ariaLabel ? "group" : undefined}
        aria-label={ariaLabel}
        className={className}
      >
        {children}
      </div>
    );
  }
  return (
    <button
      ref={vars}
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        className,
        "cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      )}
    >
      {children}
    </button>
  );
}

interface FlowChipProps {
  color: string;
  children?: ReactNode;
}

export function FlowChip({ color, children }: FlowChipProps) {
  return (
    <Badge
      variant="ghost"
      stateColor={color}
      className={cn(
        "justify-center rounded-(--radius-sm) border-(color:--badge-state) bg-[color-mix(in_srgb,var(--badge-state)_22%,var(--surface-card))] font-sans text-xs leading-none font-semibold text-foreground",
        children == null
          ? "h-2.5 min-w-2.5 p-0"
          : "h-4.5 min-w-5 px-(--space-xs)",
      )}
    >
      {children}
    </Badge>
  );
}
