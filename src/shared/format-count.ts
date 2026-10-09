const COUNT = new Intl.NumberFormat("en-US");

/** Format a count with thousands separators, such as 1284 as "1,284". */
export function formatCount(n: number): string {
  return COUNT.format(n);
}
