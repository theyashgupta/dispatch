import { useEffect, useState } from "react";
import { nowMs } from "../../../../shared/format-age.js";

/**
 * Returns the current time in ms, refreshed every second while `ticking` is true.
 *
 * @remarks The value also refreshes the moment ticking turns on, so a reopened drawer never shows ages from before it closed. That refresh is set during render, from the previous `ticking`, instead of in an effect.
 */
export function useTickingNow(ticking: boolean): number {
  const [now, setNow] = useState(() => nowMs());
  const [wasTicking, setWasTicking] = useState(ticking);
  if (ticking !== wasTicking) {
    setWasTicking(ticking);
    if (ticking) setNow(nowMs());
  }

  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(nowMs()), 1000);
    return () => clearInterval(id);
  }, [ticking]);

  return now;
}
