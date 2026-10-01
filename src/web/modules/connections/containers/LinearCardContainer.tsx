import type { ReactNode } from "react";
import { LINEAR_CONNECTION } from "../../../../shared/connection-meta.js";
import {
  CONNECTION_ERROR_COPY,
  cardStatusFrom,
} from "../../../../shared/connection-status.js";
import { CredentialSourceCard } from "@/modules/connections/components/CredentialSourceCard";
import { useSourceConnectionState } from "@/modules/connections/queries/connections-queries";

interface LinearCardContainerProps {
  details?: ReactNode;
}

export function LinearCardContainer({ details }: LinearCardContainerProps) {
  const linear = useSourceConnectionState("linear");
  const configured = linear.connection?.configured ?? false;
  return (
    <CredentialSourceCard
      meta={LINEAR_CONNECTION}
      status={cardStatusFrom(linear.connection)}
      defaultOpen={linear.startedConnected === false}
      configured={configured}
      busy={linear.busy}
      error={linear.formError ? CONNECTION_ERROR_COPY[linear.formError] : null}
      onConnect={linear.connect}
      onTest={() => void linear.test()}
      onDisconnect={() => void linear.disconnect()}
      details={configured ? details : undefined}
    />
  );
}
