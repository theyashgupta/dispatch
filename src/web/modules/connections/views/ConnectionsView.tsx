import {
  GITHUB_CONNECTION,
  SENTRY_CONNECTION,
} from "../../../../shared/connection-meta.js";
import {
  GITHUB_ERROR_COPY,
  SENTRY_ERROR_COPY,
} from "../../../../shared/connection-status.js";
import { CalendarContainer } from "@/modules/connections/containers/CalendarContainer";
import { CredentialCardContainer } from "@/modules/connections/containers/CredentialCardContainer";
import { GranolaContainer } from "@/modules/connections/containers/GranolaContainer";
import { LinearFiltersContainer } from "@/modules/connections/containers/LinearFiltersContainer";
import { SlackContainer } from "@/modules/connections/containers/SlackContainer";
import { RunSetupRow } from "@/modules/connections/components/RunSetupRow";
import { SentryDetails } from "@/modules/connections/components/SentryDetails";
import { SoonConnectionCards } from "@/modules/connections/components/SoonConnectionCards";

interface ConnectionsViewProps {
  onRunSetup: () => Promise<boolean>;
  connectionKey: number;
  errorsInFeeds: boolean;
  onToggleErrorsInFeeds: (on: boolean) => void;
  onSaved: () => void;
}

export function ConnectionsView({
  onRunSetup,
  connectionKey,
  errorsInFeeds,
  onToggleErrorsInFeeds,
  onSaved,
}: ConnectionsViewProps) {
  return (
    <LinearFiltersContainer
      connectionKey={connectionKey}
      onSaved={onSaved}
      header={<RunSetupRow onRunSetup={onRunSetup} />}
    >
      <CredentialCardContainer
        meta={GITHUB_CONNECTION}
        errorCopy={GITHUB_ERROR_COPY}
      />
      <CredentialCardContainer
        meta={SENTRY_CONNECTION}
        errorCopy={SENTRY_ERROR_COPY}
        details={
          <SentryDetails
            errorsInFeeds={errorsInFeeds}
            onToggleErrorsInFeeds={onToggleErrorsInFeeds}
          />
        }
      />
      <SlackContainer />
      <GranolaContainer />
      <CalendarContainer />
      <SoonConnectionCards />
    </LinearFiltersContainer>
  );
}
