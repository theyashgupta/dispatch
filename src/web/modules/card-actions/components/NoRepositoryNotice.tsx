import { useEffect, useRef, useState, type ComponentProps } from "react";
import { LoadingButton } from "@/components/LoadingButton";
import { WorkspaceAdd } from "@/components/WorkspaceAdd";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldError } from "@/components/ui/field";

export interface NoRepositoryModel {
  creating: boolean;
  createError: string | null;
  startDisabled: boolean;
  createDisabled: boolean;
  onCreate: () => void;
  onStartWithout: () => void;
}

interface NoRepositoryNoticeProps {
  model: NoRepositoryModel;
  onAdd: (path: string) => Promise<string | null>;
  browser: ComponentProps<typeof WorkspaceAdd>["browser"];
}

export function NoRepositoryNotice({
  model,
  onAdd,
  browser,
}: NoRepositoryNoticeProps) {
  const [adding, setAdding] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (adding) addRef.current?.querySelector("input")?.focus();
  }, [adding]);
  return (
    <Field className="gap-2">
      <Alert>
        <AlertDescription className="text-base font-semibold text-foreground">
          This board has no repository.
        </AlertDescription>
      </Alert>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={model.startDisabled}
          onClick={model.onStartWithout}
        >
          Start without a repository
        </Button>
        <LoadingButton
          variant="secondary"
          disabled={model.createDisabled}
          loading={model.creating}
          onClick={model.onCreate}
        >
          Create a repository here
        </LoadingButton>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={adding}
          onClick={() => setAdding(true)}
        >
          Add a repository
        </Button>
      </div>
      {model.createError !== null && (
        <FieldError className="font-semibold">{model.createError}</FieldError>
      )}
      {adding && (
        <div ref={addRef}>
          <WorkspaceAdd onAdd={onAdd} browser={browser} />
        </div>
      )}
    </Field>
  );
}
