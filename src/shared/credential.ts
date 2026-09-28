export const TOKEN_SHAPE = /^[\x21-\x7e]+$/;

/**
 * Whether a provider's error string is a plain lowercase code safe to show and pass on.
 *
 * @remarks Anything else (markup, prose, a quoted token) is dropped, so a hostile or verbose
 * provider answer never reaches the UI.
 */
export function isProviderCode(code: unknown): code is string {
  return typeof code === "string" && /^[a-z_]+$/.test(code);
}
