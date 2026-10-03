import { useState } from "react";

/**
 * Keep one JSON value in localStorage and read it back through a parser.
 *
 * @remarks
 * The parser receives the decoded value, or undefined when the key is absent, unreadable or not
 * valid JSON, so it alone decides the fallback. A blocked or full storage keeps the value in
 * memory for the session instead of throwing.
 */
export function useLocalStorage<T>(
  key: string,
  parse: (raw: unknown) => T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return parse(stored === null ? undefined : JSON.parse(stored));
    } catch {
      return parse(undefined);
    }
  });
  const store = (next: T) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      return;
    }
  };
  return [value, store];
}
