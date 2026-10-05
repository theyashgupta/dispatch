import type { ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { VaultKeySummary } from "../../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Item, ItemContent } from "@/components/ui/item";

interface VaultKeyRowProps {
  keySummary: VaultKeySummary;
  purposeEditor: ReactNode;
  purposeError: string | null;
  previous: ReactNode;
  valueEditor: ReactNode;
  onOpenValueEditor: () => void;
  onOpenPurposeEditor: () => void;
  onDelete: () => void;
}

export function VaultKeyRow({
  keySummary,
  purposeEditor,
  purposeError,
  previous,
  valueEditor,
  onOpenValueEditor,
  onOpenPurposeEditor,
  onDelete,
}: VaultKeyRowProps) {
  const usedBy = keySummary.usedBy ?? [];
  return (
    <Item
      variant="outline"
      size="sm"
      className="flex-col items-stretch gap-2 bg-card p-2"
      data-testid={`vault-row-${keySummary.name}`}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 font-mono text-sm font-semibold break-all text-foreground">
          {keySummary.name}
        </span>
        <Badge tone={keySummary.filled ? "success" : "warning"}>
          {keySummary.filled ? "Filled" : "Empty"}
        </Badge>
        <Button
          variant="secondary"
          size="xs"
          aria-label={
            keySummary.filled
              ? `Rotate value for ${keySummary.name}`
              : `Fill value for ${keySummary.name}`
          }
          onClick={onOpenValueEditor}
        >
          {keySummary.filled ? "Rotate" : "Set value"}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit purpose for ${keySummary.name}`}
          onClick={onOpenPurposeEditor}
        >
          <Pencil aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${keySummary.name}`}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <ItemContent className="gap-2">
        {purposeEditor ?? (
          <span className="text-sm break-words text-muted-foreground">
            {keySummary.purpose}
          </span>
        )}
        {usedBy.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {`Used by ${usedBy.join(", ")}`}
          </span>
        )}
        {purposeError !== null && (
          <FieldError role="alert" className="text-sm font-semibold">
            {purposeError}
          </FieldError>
        )}
        {previous}
        {valueEditor}
      </ItemContent>
    </Item>
  );
}
