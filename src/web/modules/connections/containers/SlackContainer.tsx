import {
  SLACK_ERROR_COPY,
  slackSaidLine,
} from "../../../../shared/connection-status.js";
import { nowMs } from "../../../../shared/format-age.js";
import { SlackCard } from "@/modules/connections/components/SlackCard";
import { SlackChannelsContainer } from "@/modules/connections/containers/SlackChannelsContainer";
import {
  showsTokenFields,
  slackCardStatus,
  slackConnectorLine,
  slackRunLine,
} from "@/modules/connections/domain/slack-connector";
import {
  usePutSlackMcpMutation,
  useRunSlackMcpMutation,
  useSlackMcpStatusQuery,
  useSourceConnectionState,
} from "@/modules/connections/queries/connections-queries";

export function SlackContainer() {
  const slack = useSourceConnectionState("slack");
  const query = useSlackMcpStatusQuery();
  const put = usePutSlackMcpMutation();
  const run = useRunSlackMcpMutation();
  const mcp = query.data ?? null;
  const mode = mcp?.mode ?? null;
  const tokenFields = mode !== null && showsTokenFields(mode);
  const configured = slack.connection?.configured ?? false;
  const enabled = tokenFields
    ? (slack.connection?.enabled ?? false)
    : mcp?.enabled === true;
  const saving = put.isPending;
  return (
    <SlackCard
      status={slackCardStatus({
        mode: mode ?? "mcp",
        mcp,
        mcpLoadFailed: query.isError,
        connection: slack.connection,
      })}
      defaultOpen={slack.startedConnected === false}
      mode={mode}
      modeDisabled={mcp === null || saving}
      onModeChange={(next) => put.mutate({ mode: next })}
      configured={configured}
      enabled={enabled}
      toggleDisabled={tokenFields ? !configured || slack.busy !== null : saving}
      botToken={slack.connection?.tokenKind === "bot"}
      busy={slack.busy}
      error={slack.formError ? SLACK_ERROR_COPY[slack.formError] : null}
      saidLine={slackSaidLine(
        slack.formError
          ? slack.formProviderError
          : slack.connection?.providerError,
      )}
      connectorLine={slackConnectorLine(mcp?.connector)}
      runLine={mcp !== null ? slackRunLine(mcp, nowMs()) : null}
      running={mcp?.running === true}
      runDisabled={!enabled || mcp?.running === true || saving}
      onToggleEnabled={() => {
        if (tokenFields) {
          void (enabled ? slack.disable() : slack.connectExisting());
        } else {
          put.mutate({ enabled: !enabled });
        }
      }}
      onConnect={slack.connect}
      onTest={() => void slack.test()}
      onDisconnect={() => void slack.disconnect()}
      onRun={() => run.mutate()}
      pickerVisible={tokenFields ? configured : enabled}
      picker={
        <SlackChannelsContainer
          key={`${mode}:${slack.connection?.account ?? ""}:${enabled}`}
          enabled={enabled}
          listOnDemand={!tokenFields}
        />
      }
    />
  );
}
