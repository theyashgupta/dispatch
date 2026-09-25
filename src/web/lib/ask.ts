export type AskAboutTarget =
  | { kind: "card"; identifier: string; title: string }
  | { kind: "item"; source: string; typeLabel: string; title: string };

/**
 * Build the question "Ask about this" puts in the Ask composer for a card or an inbox item.
 *
 * @remarks The type label keeps a leading acronym (PR review) and lowercases a leading word
 * (Issue assigned) so it reads mid-sentence.
 */
export function askAboutQuestion(target: AskAboutTarget): string {
  if (target.kind === "card") {
    return `Tell me about ${target.identifier} "${target.title}": what state is it in and what should I do next?`;
  }
  const type = /^[A-Z]{2}/.test(target.typeLabel)
    ? target.typeLabel
    : target.typeLabel.charAt(0).toLowerCase() + target.typeLabel.slice(1);
  return `Tell me about this ${target.source} ${type} "${target.title}": what is it and what should I do next?`;
}
