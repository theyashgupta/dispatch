import { useState } from "react";
import { usePlaybookPickerQuery } from "@/queries/playbook-picker-queries";
import type { PlaybookPickerModel } from "@/modules/card-actions/components/PlaybookPickerSection";
import {
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
 * Until the user picks one, the remembered default (or "Write code directly") is selected. `reload` drops the pick and reads the list again, for a refusal that names a deleted playbook.
 */
export function usePlaybookPicker(onInteraction: () => void): PlaybookPicker {
  const query = usePlaybookPickerQuery();
  const [chosen, setChosen] = useState<string | null>(null);

  const valid = query.data?.valid ?? [];
  const lastUsed = query.data?.lastUsed ?? null;
  const selected = resolvePlaybook(valid, lastUsed, chosen);
  const { seedRows, restRows } = splitPlaybooks(valid);

  return {
    view: {
      seedRows,
      restRows,
      invalidRows: query.data?.invalid ?? [],
      selected,
      lastUsed,
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
