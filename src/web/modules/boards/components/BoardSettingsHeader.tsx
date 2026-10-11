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
        <h1 className="text-xl font-semibold wrap-anywhere">{name}</h1>
        <p className="font-mono text-sm text-muted-foreground">{boardKey}</p>
      </div>
      {archived && (
        <Alert>
          <AlertDescription>This board is archived.</AlertDescription>
        </Alert>
      )}
    </>
  );
}
