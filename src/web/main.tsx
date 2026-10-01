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
import { PageFallback } from "./App.js";
import { routeTree } from "./routeTree.gen.js";
import { Splash } from "./features/splash/index.js";
import { queryClient } from "./lib/query-client.js";
import { initialHash, rememberedHash } from "../shared/route.js";

const ROUTE_KEY = "dsp.route";
const LEGACY_VIEW_KEY = "dsp.view";

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

const router = createRouter({
  routeTree,
  caseSensitive: true,
  history: createHashHistory(),
  context: { queryClient },
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
  try {
    localStorage.setItem(ROUTE_KEY, rememberedHash(`#${pathname}`));
  } catch {}
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
        <RouterProvider router={router} />
        <Splash />
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
