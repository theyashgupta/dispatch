import type { CSSProperties, ReactNode } from "react";
import { useChromeHeight } from "./hooks/useChromeHeight.js";

interface AppShellProps {
  nav: ReactNode;
  navWidth: string;
  topBar?: ReactNode;
  contentInert?: boolean;
  banner: ReactNode;
  header: ReactNode;
  content: ReactNode;
  detail: ReactNode;
  children?: ReactNode;
}

const rootStyle: CSSProperties = {
  height: "100vh",
  display: "flex",
  flexDirection: "row",
  overflow: "hidden",
};

const mainStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

export function AppShell({
  nav,
  navWidth,
  topBar,
  contentInert = false,
  banner,
  header,
  content,
  detail,
  children,
}: AppShellProps) {
  const { chromeRef, chromeHeight } = useChromeHeight();

  return (
    <div
      style={
        {
          ...rootStyle,
          "--nav-current": navWidth,
          "--chrome-top":
            chromeHeight != null
              ? `${chromeHeight}px`
              : "var(--page-header-height)",
        } as CSSProperties
      }
    >
      {nav}
      <div style={mainStyle} inert={contentInert}>
        <div ref={chromeRef} style={{ flex: "0 0 auto" }}>
          {topBar}
          {banner}
          {header}
        </div>
        {content}
      </div>
      <div style={{ display: "contents" }} inert={contentInert}>
        {detail}
      </div>
      {children}
    </div>
  );
}
