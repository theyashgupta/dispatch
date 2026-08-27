import type { Nodes, Root } from "hast";

export interface HeadingEntry {
  depth: number;
  text: string;
  id: string;
}

/**
 * GitHub-style heading slug: lowercase, punctuation stripped, spaces to hyphens.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function toText(node: Nodes): string {
  if (node.type === "text") return node.value;
  if ("children" in node) return node.children.map(toText).join("");
  return "";
}

/**
 * Rehype plugin assigning slugified ids to h1-h6 and reporting the document-order heading list.
 *
 * @remarks Ids and the TOC come from this single pass so they can never drift; duplicate slugs
 * get `-1`, `-2` suffixes like GitHub. `collect` receives the full list after the walk; callers
 * store it in a ref since this runs during React render, not inside an effect.
 */
export function rehypeHeadingIds(collect: (headings: HeadingEntry[]) => void) {
  return (tree: Root): void => {
    const seen = new Map<string, number>();
    const found: HeadingEntry[] = [];
    const walk = (node: Nodes): void => {
      if (node.type === "element" && /^h[1-6]$/.test(node.tagName)) {
        const text = toText(node);
        const base = slugify(text) || "section";
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        node.properties = { ...node.properties, id };
        found.push({ depth: Number(node.tagName[1]), text, id });
      }
      if ("children" in node) for (const child of node.children) walk(child);
    };
    walk(tree);
    collect(found);
  };
}
