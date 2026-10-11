import { useState } from "react";
import { useFolderBrowser } from "@/queries/workspace-folders-queries";

/**
 * Own the folder browser of a repository list: which row opened it and what a pick does.
 */
export function useRepositoryBrowser(
  onPick: (index: number, path: string) => void,
) {
  const browser = useFolderBrowser();
  const [index, setIndex] = useState(0);
  return {
    browser,
    open: (row: number) => {
      setIndex(row);
      browser.onOpenChange(true);
    },
    select: (path: string) => {
      onPick(index, path);
      browser.onOpenChange(false);
    },
  };
}
