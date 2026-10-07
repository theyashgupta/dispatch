import { useCallback, useLayoutEffect, useRef } from "react";

function applyVars(
  element: HTMLElement | null,
  vars: Record<string, string | undefined>,
): void {
  if (element == null) return;
  for (const [name, value] of Object.entries(vars)) {
    if (value === undefined) element.style.removeProperty(name);
    else element.style.setProperty(name, value);
  }
}

/**
 * Set CSS custom properties on an element and return a stable ref callback for it.
 *
 * @remarks Layout values that arrive as data, such as node positions, reach Tailwind classes through variables, because the JSX `style` prop is banned. The callback keeps one identity, so React does not detach and attach the ref on every render. An `undefined` value removes the property.
 */
export function useCssVars(
  vars: Record<string, string | undefined>,
): (element: HTMLElement | null) => void {
  const elementRef = useRef<HTMLElement | null>(null);
  const varsRef = useRef(vars);
  useLayoutEffect(() => {
    varsRef.current = vars;
    applyVars(elementRef.current, vars);
  });
  return useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
    applyVars(element, varsRef.current);
  }, []);
}
