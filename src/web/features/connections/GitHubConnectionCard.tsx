import { SourceIcon } from "../badges/index.js";
import { useSourceConnection } from "../../hooks/useSourceConnection.js";
import { GITHUB_CONNECTION } from "../../lib/connection-meta.js";
import {
  existingCredentialLabel,
  GITHUB_ERROR_COPY,
} from "../../lib/connection-status.js";
import { ConnectionCard } from "../../primitives/ConnectionCard.js";
import { CredentialForm } from "../../primitives/CredentialForm.js";

export function GitHubConnectionCard() {
  const github = useSourceConnection("github", GITHUB_ERROR_COPY);
  const existing = existingCredentialLabel(github.connection);
  return (
    <ConnectionCard
      badge={<SourceIcon source={GITHUB_CONNECTION.source} />}
      name={GITHUB_CONNECTION.name}
      status={github.status}
      credentialLabel={GITHUB_CONNECTION.credentialLabel}
      steps={GITHUB_CONNECTION.steps}
      scopes={GITHUB_CONNECTION.scopes}
      tokenPageUrl={GITHUB_CONNECTION.tokenPageUrl}
      footer={GITHUB_CONNECTION.footer}
      defaultOpen={github.startedConnected === false}
    >
      <CredentialForm
        label={GITHUB_CONNECTION.credentialLabel}
        configured={github.connection?.enabled ?? false}
        busy={github.busy}
        error={github.formError ? GITHUB_ERROR_COPY[github.formError] : null}
        onConnect={github.connect}
        onTest={() => void github.test()}
        onDisconnect={() => void github.disconnect()}
        useExistingLabel={existing}
        onUseExisting={
          existing ? () => void github.connectExisting() : undefined
        }
      />
    </ConnectionCard>
  );
}
