import { useEffect, useState } from "react";
import { Glyph } from "@/components/icons/Glyph";
import { Wordmark } from "@/components/Wordmark";
import { cn } from "@/lib/utils";

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
      className={cn(
        "pointer-events-none fixed inset-0 z-9999 flex flex-col items-center justify-center gap-(--space-lg) bg-background opacity-100 select-none",
        phase === "in"
          ? "animate-[splash-in_var(--motion-splash-in)_ease-out_forwards]"
          : "animate-[splash-out_var(--motion-splash-out)_ease-in_forwards]",
      )}
    >
      <Glyph size={72} />
      <Wordmark className="mt-(--space-sm) origin-center [transform:scale(2)] text-foreground" />
    </div>
  );
}
