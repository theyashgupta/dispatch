import { useState } from "react";
import { usePlaybookPickerQuery } from "@/queries/playbook-picker-queries";
import type { PlaybookPickerModel } from "@/modules/card-actions/components/PlaybookPickerSection";
import {
  filterPlaybooksByTag,
  resolvePlaybook,
  splitPlaybooks,
} from "@/modules/card-actions/domain/playbook-picker";

export interface PlaybookPicker {
  view: PlaybookPickerModel;
  selected: string | null;
  reload: () => void;
}

/**
 * Own the playbook choice of a start dialog.
 *
 * @remarks
 * Until the user picks one, the requested playbook, when listed, else the remembered default unless it has the review tag (or "Write code directly") is selected. `reload` drops the pick and reads the list again, for a refusal that names a deleted playbook.
 */
export function usePlaybookPicker(
  onInteraction: () => void,
  filter: { tag?: string; preferred?: string } = {},
): PlaybookPicker {
  const query = usePlaybookPickerQuery();
  const [chosen, setChosen] = useState<string | null>(null);

  const valid = filterPlaybooksByTag(query.data?.valid ?? [], filter.tag);
  const lastUsed = query.data?.lastUsed ?? null;
  const selected = resolvePlaybook(
    valid,
    lastUsed,
    chosen,
    filter.preferred ?? null,
  );
  const { seedRows, restRows } = splitPlaybooks(valid);

  return {
    view: {
      seedRows,
      restRows,
      invalidRows: filter.tag === undefined ? (query.data?.invalid ?? []) : [],
      loaded: query.data !== undefined,
      selected,
      lastUsed,
      tag: filter.tag,
      onSelect: (name) => {
        setChosen(name);
        onInteraction();
      },
    },
    selected,
    reload: () => {
      setChosen(null);
      void query.refetch();
    },
  };
}
