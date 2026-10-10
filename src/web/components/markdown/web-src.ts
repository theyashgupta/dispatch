/** Whether a Markdown image src or link href is an absolute http or https url. */
export function isHttpSrc(src: string): boolean {
  return /^https?:\/\//i.test(src);
}

/** Whether a Markdown link href is an in-app hash route such as `#/boards/ENG`. */
export function isAppHref(href: string): boolean {
  return href.startsWith("#/");
}
