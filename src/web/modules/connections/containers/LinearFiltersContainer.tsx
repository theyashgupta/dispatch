import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SourceFilters } from "../../../../shared/types.js";
import { LoadingButton } from "@/components/LoadingButton";
import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import { LinearFilters } from "@/modules/connections/components/LinearFilters";
import { LinearCardContainer } from "@/modules/connections/containers/LinearCardContainer";
import { LinearStateMapContainer } from "@/modules/connections/containers/LinearStateMapContainer";
import { useDebouncedValue } from "@/modules/connections/hooks/use-debounced-value";
import {
  previewStateFrom,
  previewText,
} from "@/modules/connections/domain/linear-filters";
import { connectionFromRead } from "@/modules/connections/domain/source-connection-state";
import {
  useLinearFiltersQuery,
  useLinearOptionsQuery,
  useLinearPreviewQuery,
  useRefreshLinearFilters,
  useSaveLinearFiltersMutation,
} from "@/modules/connections/queries/connections-queries";
import { useSourceConnectionQuery } from "@/queries/source-connection-queries";

interface LinearFiltersContainerProps {
  connectionKey: number;
  onSaved: () => void;
  header?: ReactNode;
  children?: ReactNode;
}

const PREVIEW_DEBOUNCE_MS = 500;

export function LinearFiltersContainer({
  connectionKey,
  onSaved,
  header,
  children,
}: LinearFiltersContainerProps) {
  const connectionQuery = useSourceConnectionQuery("linear");
  const connection = connectionFromRead(
    connectionQuery.data,
    connectionQuery.isError,
  );
  const configured = connection?.configured ?? false;
  const refreshFilters = useRefreshLinearFilters();

  const account = useRef<{ key: string | null } | null>(null);
  const hasConnection = connection !== null;
  const connected = connection?.connected;
  const accountName = connection?.account;
  useEffect(() => {
    if (!hasConnection) return;
    const key = connected ? (accountName ?? "") : null;
    const prev = account.current;
    if (prev === null || key !== null) account.current = { key };
    if (prev !== null && key !== null && prev.key !== key) {
      void refreshFilters();
    }
  }, [hasConnection, connected, accountName, refreshFilters]);

  const filtersQuery = useLinearFiltersQuery(configured);
  const assignees = useLinearOptionsQuery("assignees", configured);
  const projects = useLinearOptionsQuery("projects", configured);
  const teams = useLinearOptionsQuery("teams", configured);

  const [draft, setDraft] = useState<SourceFilters | null>(null);
  const [loadedFilters, setLoadedFilters] =
    useState<typeof filtersQuery.data>();
  if (filtersQuery.data !== loadedFilters) {
    setLoadedFilters(filtersQuery.data);
    if (filtersQuery.data) setDraft(filtersQuery.data.filters);
  }

  const settled = useDebouncedValue(draft, PREVIEW_DEBOUNCE_MS);
  const previewQuery = useLinearPreviewQuery(settled);
  const preview = previewStateFrom(
    draft,
    settled,
    previewQuery.isFetching,
    previewQuery.data,
  );

  const save = useSaveLinearFiltersMutation();
  const handleSave = () => {
    if (save.isPending || !draft) return;
    save.mutate(draft, {
      onSuccess: (result) => {
        if (result.ok) onSaved();
      },
    });
  };

  return (
    <SettingsPanelLayout
      gap="compact"
      header={header}
      footer={
        configured && (
          <LoadingButton
            onClick={handleSave}
            disabled={!draft}
            loading={save.isPending}
          >
            {save.isPending ? "Saving filters…" : "Save Filters"}
          </LoadingButton>
        )
      }
    >
      <LinearCardContainer
        key={connectionKey}
        details={
          <LinearFilters
            loadError={filtersQuery.isError}
            dimensions={filtersQuery.data?.capabilities.dimensions ?? null}
            draft={draft}
            options={{
              assignees: assignees.data?.options ?? [],
              projects: projects.data?.options ?? [],
              teams: teams.data?.options ?? [],
            }}
            optLoading={{
              assignees: assignees.isPending,
              projects: projects.isPending,
              teams: teams.isPending,
            }}
            optError={{
              assignees: assignees.isError,
              projects: projects.isError,
              teams: teams.isError,
            }}
            optTruncated={{
              assignees: assignees.data?.truncated === true,
              projects: projects.data?.truncated === true,
              teams: teams.data?.truncated === true,
            }}
            previewText={previewText(preview)}
            saveError={save.isError || save.data?.ok === false}
            onChange={setDraft}
            stateMap={<LinearStateMapContainer />}
          />
        }
      />
      {children}
    </SettingsPanelLayout>
  );
}
