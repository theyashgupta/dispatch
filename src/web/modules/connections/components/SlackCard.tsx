import type { ReactNode } from "react";
import {
  SLACK_CONNECTION,
  SLACK_CONSENT,
  SLACK_THREAD_LIMIT_NOTE,
} from "../../../../shared/connection-meta.js";
import { SLACK_BOT_NOTE } from "../../../../shared/connection-status.js";
import type { SourceCardStatus } from "../../../../shared/types.js";
import { SourceIcon } from "@/components/badges";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConnectionCard } from "@/modules/connections/components/ConnectionCard";
import { CredentialForm } from "@/modules/connections/components/CredentialForm";
import type { CredentialBusy } from "@/modules/connections/domain/source-connection-state";

interface SlackCardProps {
  status: SourceCardStatus;
  defaultOpen: boolean;
  configured: boolean;
  enabled: boolean;
  botToken: boolean;
  busy: CredentialBusy;
  error: string | null;
  saidLine: string | null;
  onToggleEnabled: () => void;
  onConnect: (value: string) => Promise<boolean>;
  onTest: () => void;
  onDisconnect: () => void;
  picker: ReactNode;
}

export function SlackCard({
  status,
  defaultOpen,
  configured,
  enabled,
  botToken,
  busy,
  error,
  saidLine,
  onToggleEnabled,
  onConnect,
  onTest,
  onDisconnect,
  picker,
}: SlackCardProps) {
  return (
    <ConnectionCard
      badge={<SourceIcon source={SLACK_CONNECTION.source} />}
      name={SLACK_CONNECTION.name}
      status={status}
      credentialLabel={SLACK_CONNECTION.credentialLabel}
      steps={SLACK_CONNECTION.steps}
      scopes={SLACK_CONNECTION.scopes}
      tokenPageUrl={SLACK_CONNECTION.tokenPageUrl}
      footer={SLACK_CONNECTION.footer}
      details={configured ? picker : undefined}
      defaultOpen={defaultOpen}
    >
      <div className="flex min-w-0 flex-col gap-4">
        <Label className="cursor-pointer gap-2 text-base font-normal">
          <Switch
            checked={enabled}
            disabled={!configured || busy !== null}
            onCheckedChange={onToggleEnabled}
          />
          Poll Slack
        </Label>
        <div className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
          {SLACK_CONSENT.map((group) => (
            <div key={group.heading}>
              <h4 className="m-0 text-sm font-semibold text-foreground">
                {group.heading}
              </h4>
              <ul className="mt-1 mb-0 list-disc pl-4 text-base text-muted-foreground">
                {group.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
      </div>
    </ConnectionCard>
  );
}
