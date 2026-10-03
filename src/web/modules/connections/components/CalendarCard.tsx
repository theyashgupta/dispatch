import { CALENDAR_CONNECTION } from "../../../../shared/connection-meta.js";
import { routeHash } from "../../../../shared/route.js";
import type {
  CalendarChoice,
  CalendarMode,
  SourceCardStatus,
} from "../../../../shared/types.js";
import { SourceIcon } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldSet } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConnectionCard } from "@/modules/connections/components/ConnectionCard";
import { LoadingButton } from "@/components/LoadingButton";
import { CALENDAR_MODE_LABELS } from "@/modules/connections/domain/calendar-selection";

interface CalendarCardProps {
  status: SourceCardStatus;
  mode: CalendarMode;
  busy: boolean;
  loadingChoices: boolean;
  choices: CalendarChoice[] | null;
  selected: ReadonlySet<string>;
  icalFilled: boolean;
  enabled: boolean;
  statusKnown: boolean;
  onModeChange: (mode: CalendarMode) => void;
  onLoad: () => void;
  onToggle: (title: string) => void;
  onSave: () => void;
  onConnect: () => void;
  onDisconnect: () => void;
}

export function CalendarCard({
  status,
  mode,
  busy,
  loadingChoices,
  choices,
  selected,
  icalFilled,
  enabled,
  statusKnown,
  onModeChange,
  onLoad,
  onToggle,
  onSave,
  onConnect,
  onDisconnect,
}: CalendarCardProps) {
  return (
    <ConnectionCard
      badge={<SourceIcon source={CALENDAR_CONNECTION.source} />}
      name={CALENDAR_CONNECTION.name}
      status={status}
      credentialLabel={CALENDAR_CONNECTION.credentialLabel}
      steps={CALENDAR_CONNECTION.steps}
      footer={CALENDAR_CONNECTION.footer}
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground">
            Read from
          </span>
          <Select
            value={mode}
            disabled={busy}
            onValueChange={(next) => onModeChange(next as CalendarMode)}
          >
            <SelectTrigger size="sm" aria-label="Read from">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(CALENDAR_MODE_LABELS) as CalendarMode[]).map(
                (key) => (
                  <SelectItem key={key} value={key}>
                    {CALENDAR_MODE_LABELS[key]}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </div>
        {mode === "macos" ? (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <LoadingButton
                variant="secondary"
                onClick={onLoad}
                loading={loadingChoices}
                disabled={loadingChoices || busy}
              >
                Load calendars
              </LoadingButton>
            </div>
            {choices !== null && (
              <FieldSet aria-label="Calendars" className="min-w-0 gap-1">
                {choices.map((choice) => (
                  <Label
                    key={choice.title}
                    className="min-w-0 cursor-pointer gap-1 text-base font-normal [overflow-wrap:anywhere]"
                  >
                    <Checkbox
                      checked={selected.has(choice.title)}
                      onCheckedChange={() => onToggle(choice.title)}
                    />
                    {choice.title}
                  </Label>
                ))}
              </FieldSet>
            )}
          </>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
              Fill CALENDAR_ICAL_URL in Settings, Vault.
            </span>
            <Badge tone={icalFilled ? "success" : "neutral"}>
              {icalFilled ? "Filled" : "Empty"}
            </Badge>
            <a
              href={routeHash({ page: "vault" })}
              className="text-sm text-foreground underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Open Vault
            </a>
          </div>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {enabled ? (
            <>
              <LoadingButton onClick={onSave} loading={busy}>
                Save
              </LoadingButton>
              <LoadingButton
                variant="secondary"
                onClick={onDisconnect}
                disabled={busy}
              >
                Disconnect
              </LoadingButton>
            </>
          ) : (
            <LoadingButton
              onClick={onConnect}
              loading={busy}
              disabled={busy || !statusKnown}
            >
              Connect
            </LoadingButton>
          )}
        </div>
      </div>
    </ConnectionCard>
  );
}
