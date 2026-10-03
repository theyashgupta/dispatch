import { Card, CardContent } from "@/components/ui/card";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/LoadingButton";
import { cn } from "@/lib/utils";

interface VaultValueEditorProps {
  name: string;
  filled: boolean;
  current:
    | { state: "loading" }
    | { state: "error" }
    | { state: "ready"; value: string };
  draft: string;
  error: string | null;
  pending: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function VaultValueEditor({
  name,
  filled,
  current,
  draft,
  error,
  pending,
  onChange,
  onCancel,
  onSave,
}: VaultValueEditorProps) {
  return (
    <Card className="gap-0 border-border bg-background py-0 shadow-none">
      <CardContent className="flex flex-col gap-2 p-2">
        {filled && (
          <div
            data-testid={`vault-current-${name}`}
            className="flex flex-col gap-1"
          >
            <span className="text-sm font-semibold text-muted-foreground">
              Current value
            </span>
            <span
              className={cn(
                "font-mono text-sm break-all select-text",
                current.state === "error"
                  ? "text-destructive-text"
                  : "text-foreground",
              )}
            >
              {current.state === "error"
                ? "Couldn't load the current value."
                : current.state === "ready"
                  ? current.value
                  : "Loading..."}
            </span>
          </div>
        )}
        <FieldLabel htmlFor={`vault-value-${name}`}>
          {filled ? "New value" : "Value"}
        </FieldLabel>
        <Input
          id={`vault-value-${name}`}
          type="text"
          autoComplete="new-password"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore="true"
          aria-label={`Value for ${name}`}
          className="font-mono"
          value={draft}
          onChange={(e) => onChange(e.target.value)}
        />
        {error !== null && (
          <FieldError role="alert" className="text-sm font-semibold">
            {error}
          </FieldError>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel edit
          </Button>
          <LoadingButton loading={pending} onClick={onSave}>
            {pending ? "Saving value..." : "Save value"}
          </LoadingButton>
        </div>
      </CardContent>
    </Card>
  );
}
