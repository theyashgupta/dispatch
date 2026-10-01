import { lazy, StrictMode, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/globals.css";
import { App } from "./App.js";
import { registerDevMoveCard } from "./modules/board/queries/board-queries.js";
import { Splash } from "./features/splash/index.js";
import { queryClient } from "./lib/query-client.js";

if (import.meta.env.DEV) {
  Object.assign(window, { __dspQueryClient: queryClient });
  registerDevMoveCard(queryClient);
}

const QueryDevtools = import.meta.env.DEV
  ? lazy(() =>
      import("@tanstack/react-query-devtools").then((m) => ({
        default: m.ReactQueryDevtools,
      })),
    )
  : null;

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Root element "#root" not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Splash />
      {QueryDevtools && (
        <Suspense fallback={null}>
          <QueryDevtools />
        </Suspense>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
