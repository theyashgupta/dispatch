import { useCallback, useState } from "react";
import type { TodayWindow } from "@/modules/today/domain/p0";
import { parseCount } from "@/modules/today/domain/p0-preferences";
import { parseRange } from "@/modules/today/domain/today-view";

const WINDOW_KEY = "dsp.p0Window";
const COUNT_KEY = "dsp.p0Count";

function readRange(): TodayWindow {
  try {
    return parseRange(localStorage.getItem(WINDOW_KEY));
  } catch {
    return "today";
  }
}

function readCount(): number {
  try {
    return parseCount(localStorage.getItem(COUNT_KEY));
  } catch {
    return 3;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

/**
 * Read and store the P0 card's window and pick count under `dsp.p0Window` and `dsp.p0Count`.
 *
 * @remarks Each value is written in its setter. A blocked or missing `localStorage` falls back to Today and 3 picks.
 */
export function useP0Preferences(): {
  range: TodayWindow;
  setRange: (next: TodayWindow) => void;
  count: number;
  setCount: (next: number) => void;
} {
  const [range, setRangeState] = useState(readRange);
  const [count, setCountState] = useState(readCount);
  const setRange = useCallback((next: TodayWindow) => {
    setRangeState(next);
    store(WINDOW_KEY, next);
  }, []);
  const setCount = useCallback((next: number) => {
    setCountState(next);
    store(COUNT_KEY, String(next));
  }, []);
  return { range, setRange, count, setCount };
}
