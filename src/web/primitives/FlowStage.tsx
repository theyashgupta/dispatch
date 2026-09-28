import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { focusRing } from "./focus-ring.js";

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

function subscribeReducedMotion(onChange: () => void): () => void {
  const mql = window.matchMedia(REDUCED_MOTION);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function reducedMotionNow(): boolean {
  return window.matchMedia(REDUCED_MOTION).matches;
}

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
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionNow,
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
      ref={outerRef}
      role="group"
      aria-label={ariaLabel}
      style={{
        width: "100%",
        maxWidth: `${width}px`,
        height: `${height * scale}px`,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          width: `${width}px`,
          height: `${height}px`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <svg
          aria-hidden="true"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          style={{ position: "absolute", inset: 0, overflow: "visible" }}
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
          <div
            key={node.id}
            style={{
              position: "absolute",
              left: `${node.x}px`,
              top: `${node.y}px`,
              width: `${node.w}px`,
              height: `${node.h}px`,
            }}
          >
            {node.children}
          </div>
        ))}
        {!reduced &&
          tokens.map((token) => (
            <span
              key={token.id}
              data-flow-token=""
              aria-hidden="true"
              onAnimationEnd={() => onTokenEnd?.(token.id)}
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                offsetPath: `path("${token.path}")`,
                offsetRotate: "0deg",
                animation: `flow-travel ${token.durationMs}ms linear ${
                  token.loop ? "infinite" : "forwards"
                }`,
                pointerEvents: "none",
              }}
            >
              <FlowChip color={token.color} />
            </span>
          ))}
      </div>
    </div>
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

const boxStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: "var(--space-xs)",
  width: "100%",
  height: "100%",
  padding: "var(--space-xs) var(--space-sm)",
  background: "var(--surface-card)",
  borderStyle: "solid",
  borderWidth: "1px",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  textAlign: "left",
  overflow: "hidden",
};

export function FlowBox({
  accent,
  tone = "var(--border)",
  dim,
  onClick,
  ariaLabel,
  children,
}: FlowBoxProps) {
  const [focused, setFocused] = useState(false);
  const composed: CSSProperties = {
    ...boxStyle,
    borderTopColor: tone,
    borderRightColor: tone,
    borderBottomColor: tone,
    borderLeftColor: accent ?? tone,
    borderLeftWidth: accent ? "3px" : "1px",
    opacity: dim ? DIM_OPACITY : 1,
  };
  if (onClick == null) {
    return (
      <div
        role={ariaLabel ? "group" : undefined}
        aria-label={ariaLabel}
        style={composed}
      >
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{ ...composed, cursor: "pointer", ...focusRing(focused) }}
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
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: children == null ? "10px" : "20px",
        height: children == null ? "10px" : "18px",
        padding: children == null ? 0 : "0 var(--space-xs)",
        borderRadius: "var(--radius-sm)",
        background: `color-mix(in srgb, ${color} 22%, var(--surface-card))`,
        border: `1px solid ${color}`,
        color: "var(--text)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-micro)",
        fontWeight: "var(--weight-semibold)",
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
}
