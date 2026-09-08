/**
 * Split a user-entered CLI-arguments string (Settings ▸ Models) into argv tokens for spawning
 * `claude`, honoring single/double-quoted segments so a flag value containing spaces (e.g.
 * `--append-system-prompt "be terse"`) survives as one token.
 *
 * @remarks This is whitespace/quote tokenizing only, never shell interpretation. The tokens are
 * later single-quoted by `claude-launch.ts#shellQuote` before being typed into the ticket's
 * login shell (`SHELL-01`), so no globbing, `$VAR` expansion, or `;`/`&&` chaining can occur;
 * control bytes are rejected there and at the Settings route. An unmatched quote is tolerated
 * (the rest of the string becomes the final token) rather than throwing, because this runs on
 * every session launch and a launch must never hard-fail on a stray quote typed into Settings.
 */
export function parseClaudeArgs(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let inToken = false;

  for (const ch of raw) {
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inToken = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inToken) {
        tokens.push(current);
        current = "";
        inToken = false;
      }
      continue;
    }
    current += ch;
    inToken = true;
  }
  if (inToken) tokens.push(current);

  return tokens;
}
