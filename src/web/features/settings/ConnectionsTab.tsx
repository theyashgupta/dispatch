import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import type {
  FilterCapabilities,
  FilterOption,
  SourceConnection,
  SourceFilters,
} from "../../../shared/types.js";
import {
  getLinearFilters,
  getLinearOptions,
  previewLinearFilters,
  saveLinearFilters,
} from "../../lib/api.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Notice } from "../../primitives/Notice.js";
import {
  GitHubConnectionCard,
  LinearConnectionCard,
  SentryConnectionCard,
  SoonConnectionCards,
} from "../connections/index.js";
import { MultiSelect } from "../modals/index.js";
import { LinearStateMapSection } from "./LinearStateMapSection.js";

type MultiDim = "assignees" | "projects" | "teams";

const MULTI_DIMS: MultiDim[] = ["assignees", "projects", "teams"];

const MULTI_COPY: Record<
  MultiDim,
  { label: string; placeholder: string; emptyText: string }
> = {
  assignees: {
    label: "Assignees",
    placeholder: "Any assignee",
    emptyText: "No assignees found",
  },
  projects: {
    label: "Projects",
    placeholder: "Any project",
    emptyText: "No projects found",
  },
  teams: {
    label: "Teams",
    placeholder: "Any team",
    emptyText: "No teams found",
  },
};

type PreviewState =
  | { status: "counting" }
  | { status: "ready"; count: number; more: boolean }
  | { status: "unavailable" };

interface FiltersTab {
  draft: SourceFilters | null;
  setDraft: Dispatch<SetStateAction<SourceFilters | null>>;
  capabilities: FilterCapabilities | null;
  options: Record<MultiDim, FilterOption[]>;
  optLoading: Record<MultiDim, boolean>;
  optError: Record<MultiDim, boolean>;
  optTruncated: Record<MultiDim, boolean>;
  preview: PreviewState;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  handleSave: () => Promise<void>;
  linearConfigured: boolean;
  onLinearConnection: (connection: SourceConnection) => void;
}

export function useFiltersTab(onSaved: () => void): FiltersTab {
  const [draft, setDraft] = useState<SourceFilters | null>(null);
  const [capabilities, setCapabilities] = useState<FilterCapabilities | null>(
    null,
  );
  const [options, setOptions] = useState<Record<MultiDim, FilterOption[]>>({
    assignees: [],
    projects: [],
    teams: [],
  });
  const [optLoading, setOptLoading] = useState<Record<MultiDim, boolean>>({
    assignees: true,
    projects: true,
    teams: true,
  });
  const [optError, setOptError] = useState<Record<MultiDim, boolean>>({
    assignees: false,
    projects: false,
    teams: false,
  });
  const [optTruncated, setOptTruncated] = useState<Record<MultiDim, boolean>>({
    assignees: false,
    projects: false,
    teams: false,
  });
  const [preview, setPreview] = useState<PreviewState>({ status: "counting" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadRound, setLoadRound] = useState(0);
  const [linearConfigured, setLinearConfigured] = useState(false);
  const linearAccount = useRef<{ key: string | null } | null>(null);

  const onLinearConnection = useCallback((connection: SourceConnection) => {
    setLinearConfigured(connection.configured);
    const key = connection.connected ? (connection.account ?? "") : null;
    const prev = linearAccount.current;
    if (prev === null || key !== null) linearAccount.current = { key };
    if (prev !== null && key !== null && prev.key !== key) {
      setLoadError(false);
      setOptLoading({ assignees: true, projects: true, teams: true });
      setOptError({ assignees: false, projects: false, teams: false });
      setLoadRound((round) => round + 1);
    }
  }, []);

  useEffect(() => {
    if (!linearConfigured) return;
    let active = true;
    void (async () => {
      try {
        const { filters, capabilities: caps } = await getLinearFilters();
        if (!active) return;
        setDraft(filters);
        setCapabilities(caps);
      } catch (err) {
        console.error("getLinearFilters failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    for (const dim of MULTI_DIMS) {
      void (async () => {
        try {
          const { options: opts, truncated } = await getLinearOptions(dim);
          if (!active) return;
          setOptions((prev) => ({ ...prev, [dim]: opts }));
          setOptTruncated((prev) => ({ ...prev, [dim]: truncated }));
        } catch (err) {
          console.error("getLinearOptions failed", err);
          if (!active) return;
          setOptError((prev) => ({ ...prev, [dim]: true }));
        } finally {
          if (active) setOptLoading((prev) => ({ ...prev, [dim]: false }));
        }
      })();
    }
    return () => {
      active = false;
    };
  }, [loadRound, linearConfigured]);

  useEffect(() => {
    if (!draft) return;
    setPreview({ status: "counting" });
    let active = true;
    const timer = setTimeout(() => {
      void (async () => {
        const result = await previewLinearFilters(draft);
        if (!active) return;
        setPreview(
          result
            ? { status: "ready", count: result.count, more: result.more }
            : { status: "unavailable" },
        );
      })();
    }, 500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [draft]);

  async function handleSave() {
    if (saving || !draft) return;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await saveLinearFilters(draft);
      if (result.ok) {
        onSaved();
        return;
      }
      setSaveError(true);
    } catch (err) {
      console.error("saveLinearFilters failed", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return {
    draft,
    setDraft,
    capabilities,
    options,
    optLoading,
    optError,
    optTruncated,
    preview,
    saving,
    saveError,
    loadError,
    handleSave,
    linearConfigured,
    onLinearConnection,
  };
}

interface FiltersTabSectionProps {
  filters: FiltersTab;
}

function FiltersTabSection({ filters }: FiltersTabSectionProps) {
  const {
    draft,
    setDraft,
    capabilities,
    options,
    optLoading,
    optError,
    optTruncated,
    preview,
    saveError,
    loadError,
  } = filters;
  const [cycleFocus, setCycleFocus] = useState(false);
  const [activeFocus, setActiveFocus] = useState(false);

  const previewText =
    preview.status === "counting"
      ? "counting…"
      : preview.status === "unavailable"
        ? "preview unavailable"
        : preview.more
          ? "Matches 250+ tickets"
          : `Matches ${preview.count} ${preview.count === 1 ? "ticket" : "tickets"}`;

  return (
    <>
      {loadError && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-body)",
            lineHeight: "var(--line-body)",
            color: "var(--text-muted)",
          }}
        >
          Couldn't load filters. Reopen settings to retry.
        </span>
      )}
      {capabilities && draft && (
        <div
          className="scroll-stable-y"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-lg)",
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
          }}
        >
          {capabilities.dimensions.map((dim) =>
            dim === "cycle" ? (
              <div
                key="cycle"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                <Field>Current cycle</Field>
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-sm)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={draft.currentCycle}
                    onChange={() =>
                      setDraft((prev) =>
                        prev
                          ? { ...prev, currentCycle: !prev.currentCycle }
                          : prev,
                      )
                    }
                    onFocus={(e) =>
                      setCycleFocus(e.currentTarget.matches(":focus-visible"))
                    }
                    onBlur={() => setCycleFocus(false)}
                    style={{
                      accentColor: "var(--accent)",
                      borderRadius: "var(--radius)",
                      outline: "none",
                      ...focusRing(cycleFocus),
                      flex: "0 0 auto",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--font-body)",
                      lineHeight: "var(--line-body)",
                      color: "var(--text)",
                    }}
                  >
                    Current cycle only
                  </span>
                </label>
                <span
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: "var(--font-body)",
                    lineHeight: "var(--line-body)",
                    color: "var(--text-muted)",
                  }}
                >
                  Backlog tickets often have no cycle, so this can drop matches
                  to near zero.
                </span>
              </div>
            ) : (
              <div
                key={dim}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                <Field>{MULTI_COPY[dim].label}</Field>
                <MultiSelect
                  label={MULTI_COPY[dim].label}
                  placeholder={MULTI_COPY[dim].placeholder}
                  options={options[dim]}
                  selected={draft[dim]}
                  loading={optLoading[dim]}
                  loadError={optError[dim]}
                  emptyText={MULTI_COPY[dim].emptyText}
                  onChange={(next) =>
                    setDraft((prev) => (prev ? { ...prev, [dim]: next } : prev))
                  }
                />
                {optError[dim] && (
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--font-body)",
                      lineHeight: "var(--line-body)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Couldn't load options. Reopen settings to retry.
                  </span>
                )}
                {optTruncated[dim] && (
                  <span
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: "var(--font-body)",
                      lineHeight: "var(--line-body)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Showing first 250 options.
                  </span>
                )}
              </div>
            ),
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
            }}
          >
            <Field>Active tickets</Field>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--space-sm)",
                cursor: "pointer",
              }}
            >
              <input
                type="checkbox"
                checked={draft.includeActive}
                onChange={() =>
                  setDraft((prev) =>
                    prev
                      ? { ...prev, includeActive: !prev.includeActive }
                      : prev,
                  )
                }
                onFocus={(e) =>
                  setActiveFocus(e.currentTarget.matches(":focus-visible"))
                }
                onBlur={() => setActiveFocus(false)}
                style={{
                  accentColor: "var(--accent)",
                  borderRadius: "var(--radius)",
                  outline: "none",
                  ...focusRing(activeFocus),
                  flex: "0 0 auto",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--font-body)",
                  lineHeight: "var(--line-body)",
                  color: "var(--text)",
                }}
              >
                Include active tickets (In Progress, In Review, ...)
              </span>
            </label>
          </div>

          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              color: "var(--text-muted)",
            }}
          >
            {previewText}
          </span>

          {saveError && (
            <Notice
              tone="destructive"
              label="Couldn't save filters. Try again."
            />
          )}

          <LinearStateMapSection />
        </div>
      )}
    </>
  );
}

const connectionsScrollStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  flex: "1 1 auto",
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--space-xs)",
};

const runSetupRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
};

const syncFiltersHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-heading)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-heading)",
  color: "var(--text)",
};

interface ConnectionsTabSectionProps {
  filters: FiltersTab;
  onRunSetup?: () => Promise<boolean>;
  connectionKey?: number;
  errorsInFeeds: boolean;
  onToggleErrorsInFeeds: (on: boolean) => void;
}

export function ConnectionsTabSection({
  filters,
  onRunSetup,
  connectionKey,
  errorsInFeeds,
  onToggleErrorsInFeeds,
}: ConnectionsTabSectionProps) {
  const [runSetup, setRunSetup] = useState<"idle" | "opening" | "failed">(
    "idle",
  );

  async function handleRunSetup(open: () => Promise<boolean>) {
    setRunSetup("opening");
    setRunSetup((await open()) ? "idle" : "failed");
  }

  return (
    <div className="scroll-stable-y" style={connectionsScrollStyle}>
      {onRunSetup && (
        <div style={runSetupRowStyle}>
          <Button
            disabled={runSetup === "opening"}
            aria-busy={runSetup === "opening"}
            onClick={() => void handleRunSetup(onRunSetup)}
          >
            Run setup guide
          </Button>
        </div>
      )}
      {runSetup === "failed" && (
        <div role="alert">
          <Notice
            tone="destructive"
            label="Couldn't load the setup checks. Try again."
          />
        </div>
      )}
      <LinearConnectionCard
        key={connectionKey}
        onConnection={filters.onLinearConnection}
      >
        <h2 style={syncFiltersHeadingStyle}>Sync filters</h2>
        <FiltersTabSection filters={filters} />
      </LinearConnectionCard>
      <GitHubConnectionCard />
      <SentryConnectionCard
        errorsInFeeds={errorsInFeeds}
        onToggleErrorsInFeeds={onToggleErrorsInFeeds}
      />
      <SoonConnectionCards />
    </div>
  );
}

interface FiltersSaveButtonProps {
  filters: FiltersTab;
}

export function FiltersSaveButton({ filters }: FiltersSaveButtonProps) {
  return (
    <Button
      variant="primary"
      onClick={() => void filters.handleSave()}
      disabled={!filters.draft}
      loading={filters.saving}
    >
      {filters.saving ? "Saving filters…" : "Save Filters"}
    </Button>
  );
}
