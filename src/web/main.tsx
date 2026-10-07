import { lazy, StrictMode, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createHashHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/globals.css";
import { PageFallback } from "./components/PageFallback.js";
import { ThemeProvider } from "./components/ThemeProvider.js";
import { createAppStore } from "./lib/app-store.js";
import { routeTree } from "./routeTree.gen.js";
import { Splash } from "./components/splash/Splash.js";
import { queryClient } from "./lib/query-client.js";
import { initialHash, rememberedHash } from "../shared/route.js";

const ROUTE_KEY = "dsp.route";
const LEGACY_VIEW_KEY = "dsp.view";
const SOUND_KEY = "dsp.sound";
const ERRORS_IN_FEEDS_KEY = "dsp.errorsInFeeds";

const leavingProtocolRelativePath = window.location.pathname.startsWith("//");
if (leavingProtocolRelativePath) {
  window.location.replace("/" + window.location.search + window.location.hash);
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

const start = initialHash(
  window.location.hash,
  readStorage(ROUTE_KEY),
  readStorage(LEGACY_VIEW_KEY),
);
if (!leavingProtocolRelativePath && start !== window.location.hash) {
  history.replaceState(history.state, "", start);
}

const appStore = createAppStore({
  soundEnabled: readStorage(SOUND_KEY) !== "off",
  errorsInFeeds: readStorage(ERRORS_IN_FEEDS_KEY) === "on",
});

if (!leavingProtocolRelativePath) {
  const params = new URLSearchParams(window.location.search);
  const pushCardId = params.get("card");
  if (pushCardId != null && pushCardId !== "") {
    appStore.openPushCard(pushCardId);
    params.delete("card");
    const search = params.toString();
    const next =
      window.location.pathname +
      (search ? `?${search}` : "") +
      window.location.hash;
    window.history.replaceState(window.history.state, "", next);
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

let persisted = "";

function persistPreferences(): void {
  const { soundEnabled, errorsInFeeds } = appStore.getState();
  const next = `${soundEnabled}:${errorsInFeeds}`;
  if (next === persisted) return;
  persisted = next;
  writeStorage(SOUND_KEY, soundEnabled ? "on" : "off");
  writeStorage(ERRORS_IN_FEEDS_KEY, errorsInFeeds ? "on" : "off");
}
persistPreferences();
appStore.subscribe(persistPreferences);

const router = createRouter({
  routeTree,
  caseSensitive: true,
  history: createHashHistory(),
  context: { queryClient, appStore },
  defaultPendingComponent: PageFallback,
  defaultPendingMs: 0,
  defaultPendingMinMs: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

router.subscribe("onResolved", () => {
  const { pathname } = router.state.location;
  if (pathname === "" || pathname === "/") return;
  writeStorage(ROUTE_KEY, rememberedHash(`#${pathname}`));
});

const QueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

const RouterDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-router-devtools").then((m) => ({
        default: m.TanStackRouterDevtools,
      })),
    )
  : null;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Root element "#root" not found');
}

if (!leavingProtocolRelativePath) {
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <RouterProvider router={router} />
          <Splash />
        </ThemeProvider>
        {QueryDevtools && (
          <Suspense fallback={null}>
            <QueryDevtools />
          </Suspense>
        )}
        {RouterDevtools && (
          <Suspense fallback={null}>
            <RouterDevtools router={router} />
          </Suspense>
        )}
      </QueryClientProvider>
    </StrictMode>,
  );
}
