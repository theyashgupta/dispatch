import { useRouteContext } from "@tanstack/react-router";
import {
  GITHUB_CONNECTION,
  SENTRY_CONNECTION,
} from "../../../../shared/connection-meta.js";
import {
  GITHUB_ERROR_COPY,
  SENTRY_ERROR_COPY,
} from "../../../../shared/connection-status.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { CalendarContainer } from "@/modules/connections/containers/CalendarContainer";
import { CredentialCardContainer } from "@/modules/connections/containers/CredentialCardContainer";
import { GranolaContainer } from "@/modules/connections/containers/GranolaContainer";
import { LinearFiltersContainer } from "@/modules/connections/containers/LinearFiltersContainer";
import { SlackContainer } from "@/modules/connections/containers/SlackContainer";
import { RunSetupRow } from "@/modules/connections/components/RunSetupRow";
import { SentryDetails } from "@/modules/connections/components/SentryDetails";
import { SoonConnectionCards } from "@/modules/connections/components/SoonConnectionCards";
import { getSetup } from "@/queries/setup-api";

export function ConnectionsContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const connectionKey = useAppStore(appStore, (s) => s.setupRuns);
  const errorsInFeeds = useAppStore(appStore, (s) => s.errorsInFeeds);

  const openSetupWizard = async (): Promise<boolean> => {
    try {
      appStore.openSetupWizard(await getSetup());
      return true;
    } catch (err) {
      console.error("getSetup failed", err);
      return false;
    }
  };

  return (
    <LinearFiltersContainer
      connectionKey={connectionKey}
      onSaved={() => appStore.notice("Settings saved.")}
      header={<RunSetupRow onRunSetup={openSetupWizard} />}
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
            onToggleErrorsInFeeds={appStore.setErrorsInFeeds}
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
