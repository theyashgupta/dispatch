import { useEffect, useState } from "react";
import { Glyph } from "../../primitives/Glyph.js";

type SplashPhase = "in" | "out" | "gone";

export function Splash() {
  const [phase, setPhase] = useState<SplashPhase>("in");

  useEffect(() => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduced) {
      timers.push(setTimeout(() => setPhase("gone"), 400));
    } else {
      timers.push(setTimeout(() => setPhase("out"), 1000));
      timers.push(setTimeout(() => setPhase("gone"), 1300));
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  if (phase === "gone") return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "var(--bg)",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-lg)",
        userSelect: "none",
        pointerEvents: "none",
        opacity: 1,
        animation:
          phase === "in"
            ? "splash-in 400ms ease-out forwards"
            : "splash-out 300ms ease-in forwards",
      }}
    >
      <Glyph size={72} />
      <span
        style={{
          fontSize: "var(--font-display)",
          fontWeight: "var(--weight-semibold)",
          letterSpacing: "0.18em",
          color: "var(--text)",
          marginTop: "var(--space-sm)",
          transform: "scale(2)",
          transformOrigin: "center",
        }}
      >
        DISPATCH
      </span>
    </div>
  );
}
