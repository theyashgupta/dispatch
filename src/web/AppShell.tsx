import type { CSSProperties, ReactNode } from "react";
import { useChromeHeight } from "./hooks/useChromeHeight.js";

export function AppShell({
  header,
  content,
  detail,
  children,
}: {
  header: ReactNode;
  content: ReactNode;
  detail: ReactNode;
  children?: ReactNode;
}) {
  const { chromeRef, chromeHeight } = useChromeHeight();

  return (
    <div
      style={
        {
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          "--chrome-top":
            chromeHeight != null ? `${chromeHeight}px` : "var(--strip-height)",
        } as CSSProperties
      }
    >
      <div ref={chromeRef} style={{ flex: "0 0 auto" }}>
        {header}
      </div>
      {content}
      {detail}
      {children}
    </div>
  );
}
