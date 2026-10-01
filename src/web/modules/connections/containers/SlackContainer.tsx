import {
  SLACK_ERROR_COPY,
  cardStatusFrom,
  slackSaidLine,
} from "../../../../shared/connection-status.js";
import { SlackCard } from "@/modules/connections/components/SlackCard";
import { SlackChannelsContainer } from "@/modules/connections/containers/SlackChannelsContainer";
import { useSourceConnectionState } from "@/modules/connections/queries/connections-queries";

export function SlackContainer() {
  const slack = useSourceConnectionState("slack");
  const configured = slack.connection?.configured ?? false;
  const enabled = slack.connection?.enabled ?? false;
  return (
    <SlackCard
      status={cardStatusFrom(slack.connection, SLACK_ERROR_COPY)}
      defaultOpen={slack.startedConnected === false}
      configured={configured}
      enabled={enabled}
      botToken={slack.connection?.tokenKind === "bot"}
      busy={slack.busy}
      error={slack.formError ? SLACK_ERROR_COPY[slack.formError] : null}
      saidLine={slackSaidLine(
        slack.formError
          ? slack.formProviderError
          : slack.connection?.providerError,
      )}
      onToggleEnabled={() =>
        void (enabled ? slack.disable() : slack.connectExisting())
      }
      onConnect={slack.connect}
      onTest={() => void slack.test()}
      onDisconnect={() => void slack.disconnect()}
      picker={
        <SlackChannelsContainer
          key={`${slack.connection?.account ?? ""}:${enabled}`}
          enabled={enabled}
        />
      }
    />
  );
}
