import type { SentryFrame } from "../../../../shared/types.js";

interface FrameCodeProps {
  frame: SentryFrame;
}

export function FrameCode({ frame }: FrameCodeProps) {
  if (frame.context.length === 0) {
    return (
      <div className="shrink-0 text-base text-muted-foreground">
        No source lines for this frame.
      </div>
    );
  }
  return (
    <pre className="m-0 shrink-0 overflow-x-auto rounded-md bg-sidebar p-2 font-mono text-xs leading-snug wrap-anywhere whitespace-pre-wrap text-foreground">
      {frame.context.map((c) => (
        <div
          key={c.line}
          className={
            c.line === frame.line
              ? "bg-destructive/16 font-semibold"
              : undefined
          }
          data-error-line={c.line === frame.line ? "true" : undefined}
        >
          {`${String(c.line).padStart(4, " ")}  ${c.code}`}
        </div>
      ))}
    </pre>
  );
}
