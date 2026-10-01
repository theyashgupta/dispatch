import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { FolderBrowserDialog } from "@/components/FolderBrowserDialog";
import { cn } from "@/lib/utils";

type BrowserProps = Omit<
  React.ComponentProps<typeof FolderBrowserDialog>,
  "onSelect"
>;

interface WorkspaceAddProps {
  onAdd: (path: string) => Promise<string | null>;
  hint?: ReactNode;
  fullWidthSubmit?: boolean;
  browser: BrowserProps;
}

export function WorkspaceAdd({
  onAdd,
  hint,
  fullWidthSubmit,
  browser,
}: WorkspaceAddProps) {
  const [value, setValue] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const trimmed = value.trim();
  const canSubmit = trimmed !== "" && !submitting;

  async function submitAdd() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const err = await onAdd(trimmed);
      if (err === null) {
        setValue("");
        setValidationError(null);
      } else {
        setValidationError(err);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Field className="gap-2">
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => browser.onOpenChange(true)}
        >
          Browse…
        </Button>
        <Input
          value={value}
          placeholder="~/Work/project-folder"
          aria-label="Workspace folder path"
          onChange={(e) => {
            setValue(e.target.value);
            setValidationError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submitAdd();
            } else if (e.key === "Escape") {
              setValidationError(null);
            }
          }}
          className="h-8 min-w-0 flex-1 font-mono text-sm md:text-sm"
        />
      </div>

      {hint && validationError === null && (
        <div className="text-base text-muted-foreground">{hint}</div>
      )}
      {validationError !== null && (
        <FieldError className="font-semibold">{validationError}</FieldError>
      )}

      <div className={cn("flex", !fullWidthSubmit && "justify-end")}>
        <Button
          type="button"
          className={cn(fullWidthSubmit && "w-full")}
          disabled={!canSubmit}
          aria-busy={submitting}
          onClick={() => void submitAdd()}
        >
          {submitting ? "Adding…" : "Add workspace"}
        </Button>
      </div>

      <FolderBrowserDialog
        {...browser}
        onSelect={(path) => {
          setValue(path);
          setValidationError(null);
          browser.onOpenChange(false);
        }}
      />
    </Field>
  );
}
