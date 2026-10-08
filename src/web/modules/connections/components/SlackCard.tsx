import type { ReactNode } from "react";
import {
  SLACK_CONNECTION,
  SLACK_CONSENT,
  SLACK_MCP_CONNECTION,
  SLACK_THREAD_LIMIT_NOTE,
} from "../../../../shared/connection-meta.js";
import { SLACK_BOT_NOTE } from "../../../../shared/connection-status.js";
import type { SlackMode, SourceCardStatus } from "../../../../shared/types.js";
import { SourceIcon } from "@/components/badges";
import { LoadingButton } from "@/components/LoadingButton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ConnectionCard } from "@/modules/connections/components/ConnectionCard";
import { CredentialForm } from "@/modules/connections/components/CredentialForm";
import {
  showsTokenFields,
  slackConsentLines,
} from "@/modules/connections/domain/slack-connector";
import type { CredentialBusy } from "@/modules/connections/domain/source-connection-state";

const MODE_LABELS: Record<SlackMode, string> = {
  mcp: "Claude Slack connector",
  token: "Slack token",
};

interface SlackCardProps {
  status: SourceCardStatus;
  defaultOpen: boolean;
  mode: SlackMode | null;
  modeDisabled: boolean;
  onModeChange: (mode: SlackMode) => void;
  configured: boolean;
  enabled: boolean;
  toggleDisabled: boolean;
  botToken: boolean;
  busy: CredentialBusy;
  error: string | null;
  saidLine: string | null;
  connectorLine: string | null;
  runLine: string | null;
  running: boolean;
  runDisabled: boolean;
  onToggleEnabled: () => void;
  onConnect: (value: string) => Promise<boolean>;
  onTest: () => void;
  onDisconnect: () => void;
  onRun: () => void;
  pickerVisible: boolean;
  picker: ReactNode;
}

export function SlackCard({
  status,
  defaultOpen,
  mode,
  modeDisabled,
  onModeChange,
  configured,
  enabled,
  toggleDisabled,
  botToken,
  busy,
  error,
  saidLine,
  connectorLine,
  runLine,
  running,
  runDisabled,
  onToggleEnabled,
  onConnect,
  onTest,
  onDisconnect,
  onRun,
  pickerVisible,
  picker,
}: SlackCardProps) {
  if (mode === null) {
    return (
      <ConnectionCard
        badge={<SourceIcon source={SLACK_CONNECTION.source} />}
        name={SLACK_CONNECTION.name}
        status={status}
        credentialLabel=""
        defaultOpen={defaultOpen}
      />
    );
  }
  const tokenFields = showsTokenFields(mode);
  const meta = tokenFields ? SLACK_CONNECTION : SLACK_MCP_CONNECTION;
  return (
    <ConnectionCard
      badge={<SourceIcon source={meta.source} />}
      name={meta.name}
      status={status}
      credentialLabel={meta.credentialLabel}
      steps={meta.steps}
      scopes={meta.scopes}
      tokenPageUrl={meta.tokenPageUrl}
      footer={meta.footer}
      details={pickerVisible ? picker : undefined}
      defaultOpen={defaultOpen}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground">
            Read Slack through
          </span>
          <Select
            value={mode}
            disabled={modeDisabled}
            onValueChange={(next) => onModeChange(next as SlackMode)}
          >
            <SelectTrigger size="sm" aria-label="Read Slack through">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODE_LABELS) as SlackMode[]).map((key) => (
                <SelectItem key={key} value={key}>
                  {MODE_LABELS[key]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Label className="cursor-pointer gap-2 text-base font-normal">
          <Switch
            checked={enabled}
            disabled={toggleDisabled}
            onCheckedChange={onToggleEnabled}
          />
          Poll Slack
        </Label>
        {!tokenFields && (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <LoadingButton
                variant="secondary"
                onClick={onRun}
                disabled={runDisabled}
              >
                Run now
              </LoadingButton>
            </div>
            {connectorLine !== null && (
              <span
                role="status"
                className="inline-flex items-center gap-1 text-sm [overflow-wrap:anywhere] text-muted-foreground"
              >
                {connectorLine}
              </span>
            )}
            {runLine !== null && (
              <span className="inline-flex items-center gap-1 text-sm [overflow-wrap:anywhere] text-muted-foreground">
                {running && <Spinner aria-hidden="true" className="size-3.5" />}
                {runLine}
              </span>
            )}
          </div>
        )}
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          {SLACK_CONSENT.map((group) => (
            <div key={group.heading}>
              <h4 className="m-0 text-sm font-semibold text-foreground">
                {group.heading}
              </h4>
              <ul className="mt-1 mb-0 list-disc pl-4 text-base text-muted-foreground">
                {slackConsentLines(group.lines, mode).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {tokenFields && (
          <>
            <p className="m-0 text-sm [overflow-wrap:anywhere] text-muted-foreground">
              {SLACK_THREAD_LIMIT_NOTE}
            </p>
            <CredentialForm
              label={SLACK_CONNECTION.credentialLabel}
              configured={configured}
              busy={busy}
              error={error}
              onConnect={onConnect}
              onTest={onTest}
              onDisconnect={onDisconnect}
            />
            {saidLine && (
              <p className="m-0 text-sm [overflow-wrap:anywhere] text-muted-foreground">
                {saidLine}
              </p>
            )}
            {botToken && (
              <p className="m-0 text-sm [overflow-wrap:anywhere] text-muted-foreground">
                {SLACK_BOT_NOTE}
              </p>
            )}
          </>
        )}
      </div>
    </ConnectionCard>
  );
}
