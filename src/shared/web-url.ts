/**
 * Tell whether a url is an http or https url.
 *
 * @remarks
 * Anything else never reaches window.open or the clipboard. Connector urls are third-party input, so
 * a javascript: or data: scheme would run in the app's origin through the Open link action; the
 * allow-list closes that at the action gate.
 */
export function isWebUrl(url: string | undefined): url is string {
  if (url == null) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
