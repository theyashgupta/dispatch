import type { ReactNode } from "react";
import type { ConnectionMeta } from "../../../../shared/connection-meta.js";
import {
  cardStatusFrom,
  existingCredentialLabel,
} from "../../../../shared/connection-status.js";
import type { SourceKeyError } from "../../../../shared/types.js";
import { CredentialSourceCard } from "@/modules/connections/components/CredentialSourceCard";
import { useSourceConnectionState } from "@/modules/connections/queries/connections-queries";

interface CredentialCardContainerProps {
  meta: ConnectionMeta;
  errorCopy: Record<SourceKeyError, string>;
  details?: ReactNode;
}

export function CredentialCardContainer({
  meta,
  errorCopy,
  details,
}: CredentialCardContainerProps) {
  const state = useSourceConnectionState(meta.source);
  const existing = existingCredentialLabel(state.connection);
  return (
    <CredentialSourceCard
      meta={meta}
      status={cardStatusFrom(state.connection, errorCopy)}
      defaultOpen={state.startedConnected === false}
      configured={state.connection?.enabled ?? false}
      busy={state.busy}
      error={state.formError ? errorCopy[state.formError] : null}
      onConnect={state.connect}
      onTest={() => void state.test()}
      onDisconnect={() => void state.disconnect()}
      useExistingLabel={existing}
      onUseExisting={existing ? () => void state.connectExisting() : undefined}
      details={details}
    />
  );
}
