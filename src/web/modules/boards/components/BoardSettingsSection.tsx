import type { FormEvent, ReactNode } from "react";
import { LoadingButton } from "@/components/LoadingButton";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface BoardSettingsSectionProps {
  id: string;
  title: string;
  description: string;
  canSave?: boolean;
  saving?: boolean;
  onSave?: () => void;
  children: ReactNode;
}

export function BoardSettingsSection({
  id,
  title,
  description,
  canSave = false,
  saving = false,
  onSave,
  children,
}: BoardSettingsSectionProps) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSave && !saving) onSave?.();
  };
  const content = (
    <CardContent className="flex flex-col gap-3">{children}</CardContent>
  );
  return (
    <Card role="region" aria-labelledby={`${id}-title`}>
      <CardHeader>
        <CardTitle id={`${id}-title`} role="heading" aria-level={2}>
          {title}
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {onSave === undefined ? (
        content
      ) : (
        <form noValidate className="contents" onSubmit={submit}>
          {content}
          <CardFooter>
            <LoadingButton
              type="submit"
              loading={saving}
              disabled={!canSave}
              aria-label={`Save ${title.toLowerCase()}`}
            >
              Save
            </LoadingButton>
          </CardFooter>
        </form>
      )}
    </Card>
  );
}
