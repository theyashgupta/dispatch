import { Bot, RotateCcw } from "lucide-react";
import { DEFAULT_CLAUDE_ARGS } from "../../../../shared/types.js";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Caption } from "@/modules/settings/components/Caption";
import { LoadError } from "@/modules/settings/components/LoadError";
import { LoadingButton } from "@/components/LoadingButton";

interface ClaudeArgsSectionProps {
  draft: string;
  loaded: boolean;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
}

export function ClaudeArgsSection({
  draft,
  loaded,
  saving,
  saveError,
  loadError,
  onDraftChange,
  onSave,
}: ClaudeArgsSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      {loadError && (
        <LoadError text="Couldn't load Claude's launch arguments. Reopen settings to retry." />
      )}
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot aria-hidden="true" className="size-4" />
            Claude
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-4">
          <Field className="gap-1">
            <Caption>Command</Caption>
            <span className="font-mono text-base text-muted-foreground">
              claude
            </span>
          </Field>
          <Field className="gap-1">
            <div className="flex items-center justify-between">
              <Caption>Arguments</Caption>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="w-auto text-muted-foreground"
                onClick={() => onDraftChange(DEFAULT_CLAUDE_ARGS)}
              >
                <RotateCcw aria-hidden="true" />
                Reset to default
              </Button>
            </div>
            <Input
              type="text"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              spellCheck={false}
              aria-label="Claude launch arguments"
              placeholder={DEFAULT_CLAUDE_ARGS}
              className="h-8 font-mono text-base md:text-base"
            />
            <FieldDescription>
              Passed to <code>claude</code> every time a session starts,
              resumes, or restarts. Clear this to get Claude's normal permission
              prompts instead of skipping them.
            </FieldDescription>
          </Field>
          {saveError && (
            <Alert variant="destructive">
              <AlertDescription className="font-semibold">
                Couldn't save Claude's arguments. Try again.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
      <div>
        <LoadingButton disabled={!loaded} loading={saving} onClick={onSave}>
          {saving ? "Saving…" : "Save"}
        </LoadingButton>
      </div>
    </section>
  );
}
