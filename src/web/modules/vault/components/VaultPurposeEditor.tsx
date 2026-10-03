import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface VaultPurposeEditorProps {
  name: string;
  draft: string;
  pending: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function VaultPurposeEditor({
  name,
  draft,
  pending,
  onChange,
  onSave,
  onCancel,
}: VaultPurposeEditorProps) {
  return (
    <div className="flex items-center gap-1">
      <Input
        aria-label={`Purpose for ${name}`}
        value={draft}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Save purpose for ${name}`}
        disabled={pending}
        onClick={onSave}
      >
        <Check aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Cancel purpose edit for ${name}`}
        onClick={onCancel}
      >
        <X aria-hidden="true" />
      </Button>
    </div>
  );
}
