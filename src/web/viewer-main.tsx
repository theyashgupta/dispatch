import {
  Component,
  lazy,
  StrictMode,
  Suspense,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";

const ViewerDoc = lazy(() => import("./viewer/ViewerDoc.js"));

const POPSTATE_EVENT = "popstate";

type ViewState =
  | { status: "loading" }
  | { status: "loaded"; source: string; path: string }
  | { status: "error"; heading: string; body: string };

const LOADING: ViewState = { status: "loading" };

const NOT_FOUND: ViewState = {
  status: "error",
  heading: "File not found",
  body: "This file doesn't exist or is outside your registered workspaces.",
};

const TOO_LARGE: ViewState = {
  status: "error",
  heading: "File too large to preview",
  body: "This file is over the 2 MB viewer limit. Open it in your editor instead.",
};

const COULDNT_LOAD = {
  status: "error",
  heading: "Couldn't load file",
  body: "Check that Dispatch is running, then reload the page.",
} as const;

const centerStackStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "var(--space-sm)",
  paddingTop: "var(--space-3xl)",
  textAlign: "center",
};

const stateHeadingStyle: CSSProperties = {
  fontSize: "19px",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text)",
};

const stateBodyStyle: CSSProperties = {
  fontSize: "15px",
  color: "var(--text-muted)",
};

const filePathLineStyle: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "13px",
  color: "var(--text-muted)",
  padding: "var(--space-lg) var(--space-lg) 0",
};

function readPathAndFragment(): { path: string | null; fragment: string } {
  const params = new URLSearchParams(window.location.search);
  return {
    path: params.get("path"),
    fragment: window.location.hash.replace(/^#/, ""),
  };
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function jumpToFragment(fragment: string): boolean {
  const el = document.getElementById(fragment);
  if (el) el.scrollIntoView();
  return el != null;
}

async function fetchFile(path: string): Promise<ViewState> {
  try {
    const res = await fetch(
      `/api/viewer/file?path=${encodeURIComponent(path)}`,
    );
    if (res.status === 200) {
      return { status: "loaded", source: await res.text(), path };
    }
    if (res.status === 400 || res.status === 404) return NOT_FOUND;
    if (res.status === 413) return TOO_LARGE;
    return COULDNT_LOAD;
  } catch {
    return COULDNT_LOAD;
  }
}

function LoadingState() {
  return (
    <div style={centerStackStyle}>
      <p style={stateBodyStyle}>Loading…</p>
    </div>
  );
}

function ErrorState({ heading, body }: { heading: string; body: string }) {
  return (
    <div style={centerStackStyle}>
      <p style={stateHeadingStyle}>{heading}</p>
      <p style={stateBodyStyle}>{body}</p>
    </div>
  );
}

class ChunkErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) {
      return (
        <ErrorState heading={COULDNT_LOAD.heading} body={COULDNT_LOAD.body} />
      );
    }
    return this.props.children;
  }
}

function ViewerApp() {
  const [state, setState] = useState<ViewState>(LOADING);
  const [fragment, setFragment] = useState("");
  const navSeq = useRef(0);
  const loadedPath = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = (): void => {
      const seq = ++navSeq.current;
      const { path, fragment: frag } = readPathAndFragment();
      setFragment(frag);
      if (path == null) {
        setState(NOT_FOUND);
        return;
      }
      if (path === loadedPath.current) return;
      setState(LOADING);
      void fetchFile(path).then((next) => {
        if (cancelled || seq !== navSeq.current) return;
        setState(next);
        if (next.status === "loaded") {
          loadedPath.current = next.path;
          document.title = basename(next.path);
        }
      });
    };

    load();
    window.addEventListener(POPSTATE_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(POPSTATE_EVENT, load);
    };
  }, []);

  useEffect(() => {
    if (state.status !== "loaded" || fragment === "") return;
    if (jumpToFragment(fragment)) return;
    const observer = new MutationObserver(() => {
      if (jumpToFragment(fragment)) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [state, fragment]);

  const onNavigate = (path: string, frag: string): void => {
    const url = `/viewer/?path=${encodeURIComponent(path)}${frag !== "" ? `#${frag}` : ""}`;
    history.pushState({}, "", url);
    setFragment(frag);
    setState(LOADING);
    const seq = ++navSeq.current;
    void fetchFile(path).then((next) => {
      if (seq !== navSeq.current) return;
      setState(next);
      if (next.status === "loaded") {
        loadedPath.current = next.path;
        document.title = basename(next.path);
        if (frag === "") window.scrollTo(0, 0);
      }
    });
  };

  return (
    <>
      {state.status === "loaded" ? (
        <p style={filePathLineStyle}>{state.path}</p>
      ) : null}
      {state.status === "loading" ? <LoadingState /> : null}
      {state.status === "error" ? (
        <ErrorState heading={state.heading} body={state.body} />
      ) : null}
      {state.status === "loaded" ? (
        <ChunkErrorBoundary>
          <Suspense fallback={<LoadingState />}>
            <ViewerDoc
              source={state.source}
              filePath={state.path}
              onNavigate={onNavigate}
            />
          </Suspense>
        </ChunkErrorBoundary>
      ) : null}
    </>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Root element "#root" not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <ViewerApp />
  </StrictMode>,
);
