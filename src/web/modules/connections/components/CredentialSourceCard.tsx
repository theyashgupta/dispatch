import type { ReactNode } from "react";
import type { ConnectionMeta } from "../../../../shared/connection-meta.js";
import type { SourceCardStatus } from "../../../../shared/types.js";
import { SourceIcon } from "@/components/badges";
import { ConnectionCard } from "@/modules/connections/components/ConnectionCard";
import { CredentialForm } from "@/modules/connections/components/CredentialForm";
import type { CredentialBusy } from "@/modules/connections/domain/source-connection-state";

interface CredentialSourceCardProps {
  meta: ConnectionMeta;
  status: SourceCardStatus;
  defaultOpen: boolean;
  configured: boolean;
  busy: CredentialBusy;
  error: string | null;
  onConnect: (value: string) => Promise<boolean>;
  onTest: () => void;
  onDisconnect: () => void;
  useExistingLabel?: string;
  onUseExisting?: () => void;
  details?: ReactNode;
}

export function CredentialSourceCard({
  meta,
  status,
  defaultOpen,
  configured,
  busy,
  error,
  onConnect,
  onTest,
  onDisconnect,
  useExistingLabel,
  onUseExisting,
  details,
}: CredentialSourceCardProps) {
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
      details={details}
      defaultOpen={defaultOpen}
    >
      <CredentialForm
        label={meta.credentialLabel}
        configured={configured}
        busy={busy}
        error={error}
        onConnect={onConnect}
        onTest={onTest}
        onDisconnect={onDisconnect}
        useExistingLabel={useExistingLabel}
        onUseExisting={onUseExisting}
      />
    </ConnectionCard>
  );
}
