import { Alert, AlertDescription } from "@/components/ui/alert";

interface BoardSettingsHeaderProps {
  name: string;
  boardKey: string;
  archived: boolean;
}

export function BoardSettingsHeader({
  name,
  boardKey,
  archived,
}: BoardSettingsHeaderProps) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Board settings</h1>
        <p className="text-sm wrap-anywhere text-muted-foreground">
          {name} <span className="font-mono">({boardKey})</span>
        </p>
      </div>
      {archived && (
        <Alert>
          <AlertDescription>This board is archived.</AlertDescription>
        </Alert>
      )}
    </>
  );
}
