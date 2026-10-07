/** Whether a Markdown image src or link href is an absolute http or https url. */
export function isHttpSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}
