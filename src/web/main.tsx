import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import { App } from "./App.js";
import { Splash } from "./features/splash/index.js";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error('Root element "#root" not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
    <Splash />
  </StrictMode>,
);
