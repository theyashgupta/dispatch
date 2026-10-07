/** Resolves with the promise value, or undefined once the timer wins. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms, undefined);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
