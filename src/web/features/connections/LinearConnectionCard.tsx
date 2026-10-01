import { useEffect, type ReactNode } from "react";
import type { SourceConnection } from "../../../shared/types.js";
import { SourceIcon } from "../../components/badges/index.js";
import { useLinearConnection } from "../../hooks/useLinearConnection.js";
import { LINEAR_CONNECTION } from "../../lib/connection-meta.js";
import { CONNECTION_ERROR_COPY } from "../../lib/connection-status.js";
import { ConnectionCard } from "../../primitives/ConnectionCard.js";
import { CredentialForm } from "../../primitives/CredentialForm.js";

interface LinearConnectionCardProps {
  children?: ReactNode;
  onConnection?: (connection: SourceConnection) => void;
}

export function LinearConnectionCard({
  children,
  onConnection,
}: LinearConnectionCardProps) {
  const linear = useLinearConnection();
  useEffect(() => {
    if (linear.connection) onConnection?.(linear.connection);
  }, [linear.connection, onConnection]);
  const configured = linear.connection?.configured ?? false;
  return (
    <ConnectionCard
      badge={<SourceIcon source={LINEAR_CONNECTION.source} />}
      name={LINEAR_CONNECTION.name}
      status={linear.status}
      credentialLabel={LINEAR_CONNECTION.credentialLabel}
      steps={LINEAR_CONNECTION.steps}
      scopes={LINEAR_CONNECTION.scopes}
      tokenPageUrl={LINEAR_CONNECTION.tokenPageUrl}
      footer={LINEAR_CONNECTION.footer}
      details={configured ? children : undefined}
      defaultOpen={linear.startedConnected === false}
    >
      <CredentialForm
        label={LINEAR_CONNECTION.credentialLabel}
        configured={configured}
        busy={linear.busy}
        error={
          linear.formError ? CONNECTION_ERROR_COPY[linear.formError] : null
        }
        onConnect={linear.connect}
        onTest={() => void linear.test()}
        onDisconnect={() => void linear.disconnect()}
      />
    </ConnectionCard>
  );
}
