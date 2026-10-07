/** Work out which of the Previous and Next buttons the Today pager disables. */
export function pagerState(
  page: number,
  pageCount: number,
): { previousDisabled: boolean; nextDisabled: boolean } {
  return { previousDisabled: page <= 1, nextDisabled: page >= pageCount };
}
