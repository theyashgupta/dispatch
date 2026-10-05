import { useRef } from "react";
import type { MutateOptions } from "@tanstack/react-query";

type Mutate<TData, TError, TVariables, TOnMutateResult> = (
  variables: TVariables,
  options?: MutateOptions<TData, TError, TVariables, TOnMutateResult>,
) => void;

/**
 * Wrap a mutation's `mutate` so a call made while an earlier call is still in flight is dropped.
 *
 * @remarks
 * `isPending` reaches React on a later tick than `mutate()`, so a double click passes a render-time
 * `isPending` guard twice and sends two requests; the box flips synchronously.
 */
export function singleFlight<TData, TError, TVariables, TOnMutateResult>(
  box: { current: boolean },
  mutate: Mutate<TData, TError, TVariables, TOnMutateResult>,
): Mutate<TData, TError, TVariables, TOnMutateResult> {
  return (variables, options) => {
    if (box.current) return;
    box.current = true;
    mutate(variables, {
      ...options,
      onSettled: (...args) => {
        box.current = false;
        options?.onSettled?.(...args);
      },
    });
  };
}

/** Hook form of {@link singleFlight}; the in-flight flag lives for the component's lifetime. */
export function useSingleFlight<TData, TError, TVariables, TOnMutateResult>(
  mutate: Mutate<TData, TError, TVariables, TOnMutateResult>,
): Mutate<TData, TError, TVariables, TOnMutateResult> {
  const box = useRef(false);
  return (variables, options) => singleFlight(box, mutate)(variables, options);
}
