import { readFile } from "node:fs/promises";

const RULEBOOK_URL = new URL(
  "../../../../docs/orchestration/rulebook.md",
  import.meta.url,
);

/**
 * Read the orchestration rule book that ships with the package.
 *
 * @remarks Four levels up is the repository root under src and the package root under dist.
 */
export async function readRulebook(): Promise<{
  markdown: string;
  bytes: number;
}> {
  const markdown = await readFile(RULEBOOK_URL, "utf8");
  return { markdown, bytes: Buffer.byteLength(markdown, "utf8") };
}
