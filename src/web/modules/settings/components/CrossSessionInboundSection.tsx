import { MessagesSquare } from "lucide-react";
import {
  CROSS_SESSION_INBOUND_VALUES,
  type CrossSessionInbound,
} from "../../../../shared/types.js";
import { ErrorAlert } from "@/components/ErrorAlert";
import { LoadingButton } from "@/components/LoadingButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadError } from "@/modules/settings/components/LoadError";

const OPTIONS: { value: CrossSessionInbound; label: string }[] = [
  { value: "accept", label: "Accept" },
  { value: "hold", label: "Hold for review" },
  { value: "refuse", label: "Refuse" },
];

interface CrossSessionInboundSectionProps {
  draft: CrossSessionInbound;
  loaded: boolean;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  onDraftChange: (value: CrossSessionInbound) => void;
  onSave: () => void;
}

export function CrossSessionInboundSection({
  draft,
  loaded,
  saving,
  saveError,
  loadError,
  onDraftChange,
  onSave,
}: CrossSessionInboundSectionProps) {
  return (
    <section className="flex flex-col gap-4">
      {loadError && (
        <LoadError text="Couldn't load the messages setting. Reopen settings to retry." />
      )}
      <Card className="gap-4 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessagesSquare aria-hidden="true" className="size-4" />
            Messages
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-4">
          <Field className="gap-1">
            <Label htmlFor="settings-cross-session-inbound">
              Messages from other Claude sessions
            </Label>
            <Select
              value={draft}
              disabled={!loaded}
              onValueChange={(value) => {
                const next = CROSS_SESSION_INBOUND_VALUES.find(
                  (v) => v === value,
                );
                if (next) onDraftChange(next);
              }}
            >
              <SelectTrigger
                id="settings-cross-session-inbound"
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-w-[calc(100vw-2rem)]">
                {OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>
              Applies to sessions that you start from a ticket. Roadmap Loop and
              orchestrator sessions refuse these messages unless the board
              policy or the start request sets a value. A running session keeps
              its value until it restarts.
            </FieldDescription>
          </Field>
          {saveError && (
            <ErrorAlert>
              Couldn't save the messages setting. Try again.
            </ErrorAlert>
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
