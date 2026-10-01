import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useReturnFocus } from "@/modules/shell/hooks/use-return-focus";

export interface ShortcutRow {
  key: string;
  label: string;
  meta?: boolean;
}

export interface ShortcutGroup {
  title: string;
  rows: readonly ShortcutRow[];
}

interface CheatSheetProps {
  groups: readonly ShortcutGroup[];
  onClose: () => void;
}

const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export function CheatSheet({ groups, onClose }: CheatSheetProps) {
  const returnFocus = useReturnFocus();
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-[760px]"
        onCloseAutoFocus={returnFocus}
      >
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div className="grid max-h-[70vh] grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-6 overflow-y-auto">
          {groups.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
                {group.title}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {group.rows.map((row) => (
                  <li
                    key={`${row.meta === true ? "meta+" : ""}${row.key}`}
                    className="flex min-h-6 items-center justify-between gap-2 text-base text-foreground"
                  >
                    <span>{row.label}</span>
                    <span className="inline-flex gap-0.5">
                      {row.meta === true && <Kbd>{MOD_KEY}</Kbd>}
                      <Kbd>
                        {row.meta === true ? row.key.toUpperCase() : row.key}
                      </Kbd>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
