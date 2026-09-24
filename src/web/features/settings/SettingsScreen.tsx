import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  Bell,
  Bot,
  Copy,
  Filter,
  FolderGit2,
  Globe,
  RotateCcw,
  SquareTerminal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_CLAUDE_ARGS,
  type FilterCapabilities,
  type FilterOption,
  type SourceFilters,
  type TerminalAppearance,
  type TunnelState,
} from "../../../shared/types.js";
import {
  DEFAULT_TERMINAL_APPEARANCE,
  TERMINAL_APPEARANCE_CHANNEL,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  validateTerminalAppearance,
} from "../../../shared/terminal-appearance.js";
import { FONT_FAMILY } from "../../../shared/nerd-font-mono.js";
import {
  detectInstalledFonts,
  fontOptionLabel,
} from "../../lib/terminal-fonts.js";
import {
  addWorkspaceFolder,
  disableRemote,
  enableRemote,
  getCleanupDelay,
  getClaudeArgs,
  getLinearFilters,
  getLinearOptions,
  getTerminalAppearance,
  getWorkspaceFolders,
  previewLinearFilters,
  removeWorkspaceFolder,
  saveCleanupDelay,
  saveClaudeArgs,
  saveLinearFilters,
  saveTerminalAppearance,
} from "../../lib/api.js";
import { playChime } from "../../lib/chime.js";
import {
  disablePush,
  enablePush,
  isIOSDevice,
  isPushSupported,
  readPushSubscription,
  type PushEnableResult,
} from "../../lib/push.js";
import { useMediaQuery } from "../../hooks/useMediaQuery.js";
import { Button } from "../../primitives/Button.js";
import { Collapsible } from "../../primitives/Collapsible.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { IconButton } from "../../primitives/IconButton.js";
import { Notice } from "../../primitives/Notice.js";
import { QrCode } from "../../primitives/QrCode.js";
import { MultiSelect } from "../modals/index.js";
import { WorkspaceAdd } from "../workspaces/index.js";
import type { SettingsTab } from "../../lib/settings-tab.js";
import { NAV_ITEMS } from "../nav/index.js";
import type { Page } from "../../lib/route.js";

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
}

function useFiltersTab(onSaved: () => void): FiltersTab {
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

  useEffect(() => {
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
  }, []);

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
        </div>
      )}
    </>
  );
}

interface RemoteTab {
  pending: boolean;
  handleEnable: () => Promise<void>;
  handleDisable: () => Promise<void>;
}

function useRemoteTab(): RemoteTab {
  const [pending, setPending] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleEnable() {
    if (pending) return;
    setPending(true);
    try {
      await enableRemote();
    } catch (err) {
      console.error("enableRemote failed", err);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }

  async function handleDisable() {
    if (pending) return;
    setPending(true);
    try {
      await disableRemote();
    } catch (err) {
      console.error("disableRemote failed", err);
    } finally {
      if (mountedRef.current) setPending(false);
    }
  }

  return { pending, handleEnable, handleDisable };
}

function useCopyFlash(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };
  return [copied, copy];
}

const remoteSectionStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  flex: "1 1 auto",
  minHeight: 0,
} as const;

const remoteBodyTextStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
} as const;

const remoteHelperTextStyle = {
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
} as const;

const remoteStatusRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
} as const;

const remoteDotStyle = {
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  flex: "0 0 auto",
} as const;

const remoteFieldBlockStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
} as const;

const remoteMonoRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-xs)",
} as const;

const remoteMonoTextStyle = {
  fontFamily: "var(--font-mono)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

const remoteMonoLinkStyle = {
  ...remoteMonoTextStyle,
  color: "var(--accent)",
  textDecoration: "none",
} as const;

function RemoteStatusRow({ color, text }: { color: string; text: string }) {
  return (
    <div role="status" aria-live="polite" style={remoteStatusRowStyle}>
      <span
        aria-hidden="true"
        style={{ ...remoteDotStyle, background: color }}
      />
      {text}
    </div>
  );
}

interface RemoteTabSectionProps {
  tunnelState: TunnelState;
  remoteTab: RemoteTab;
}

function RemoteTabSection({ tunnelState, remoteTab }: RemoteTabSectionProps) {
  const { pending, handleEnable, handleDisable } = remoteTab;
  const [urlCopied, copyUrl] = useCopyFlash();
  const [codeCopied, copyCode] = useCopyFlash();
  const [brewCopied, copyBrew] = useCopyFlash();

  if (tunnelState.status === "off") {
    return (
      <div style={remoteSectionStyle}>
        <div style={remoteBodyTextStyle}>
          Reach this board, including live terminals, from any device over a
          temporary public link, guarded by an access code.
        </div>
        <div>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => void handleEnable()}
          >
            {pending ? "Starting…" : "Enable remote access"}
          </Button>
        </div>
        <span style={remoteHelperTextStyle}>
          Uses an on-demand Cloudflare tunnel. Requires cloudflared.
        </span>
      </div>
    );
  }

  if (tunnelState.status === "starting") {
    return (
      <div style={remoteSectionStyle}>
        <RemoteStatusRow color="var(--status-stale)" text="Starting tunnel…" />
        <div>
          <Button variant="primary" disabled loading>
            Enable remote access
          </Button>
        </div>
      </div>
    );
  }

  if (tunnelState.status === "on") {
    return (
      <div style={remoteSectionStyle}>
        <RemoteStatusRow color="var(--status-ok)" text="Remote access on" />
        <div style={remoteFieldBlockStyle}>
          <Field>Public URL</Field>
          <div style={remoteMonoRowStyle}>
            <a
              href={tunnelState.url}
              target="_blank"
              rel="noopener noreferrer"
              style={remoteMonoLinkStyle}
            >
              {tunnelState.url}
            </a>
            <IconButton
              aria-label={urlCopied ? "Copied" : "Copy public URL"}
              onClick={() => copyUrl(tunnelState.url)}
            >
              <Copy size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <Collapsible title="QR code">
          <QrCode
            value={`${tunnelState.url}?code=${encodeURIComponent(tunnelState.code)}`}
          />
        </Collapsible>
        <div style={remoteFieldBlockStyle}>
          <Field>Access code: enter this on a device without the QR</Field>
          <div style={remoteMonoRowStyle}>
            <span style={remoteMonoTextStyle}>{tunnelState.code}</span>
            <IconButton
              aria-label={codeCopied ? "Copied" : "Copy access code"}
              onClick={() => copyCode(tunnelState.code)}
            >
              <Copy size={14} strokeWidth={2} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
        <div>
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => void handleDisable()}
          >
            {pending ? "Disabling…" : "Disable remote access"}
          </Button>
        </div>
      </div>
    );
  }

  if (tunnelState.status === "error") {
    return (
      <div style={remoteSectionStyle}>
        <RemoteStatusRow
          color="var(--status-down)"
          text={tunnelState.message}
        />
        <div>
          <Button
            variant="primary"
            loading={pending}
            onClick={() => void handleEnable()}
          >
            {pending ? "Starting…" : "Enable remote access"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div style={remoteSectionStyle}>
      <RemoteStatusRow
        color="var(--status-down)"
        text="cloudflared not found"
      />
      <div style={remoteBodyTextStyle}>{tunnelState.installHint}</div>
      <div style={remoteFieldBlockStyle}>
        <Field>Install command</Field>
        <div style={remoteMonoRowStyle}>
          <span style={remoteMonoTextStyle}>brew install cloudflared</span>
          <IconButton
            aria-label={brewCopied ? "Copied" : "Copy install command"}
            onClick={() => copyBrew("brew install cloudflared")}
          >
            <Copy size={14} strokeWidth={2} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

type DesktopPermission = "granted" | "denied" | "default" | "unsupported";

function useDesktopPermission(): {
  status: DesktopPermission;
  request: () => void;
} {
  const [status, setStatus] = useState<DesktopPermission>(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );

  const request = useCallback(() => {
    if (!("Notification" in window)) return;
    void Notification.requestPermission().then((result) => {
      setStatus(result);
    });
  }, []);

  return { status, request };
}

type PushRowState =
  | "ios-needs-install"
  | "unsupported"
  | "default"
  | "enabling"
  | "enabled"
  | "disabling"
  | "denied";

function usePushSubscription(): {
  state: PushRowState;
  error: "cap" | "generic" | null;
  enable: () => void;
  disable: () => void;
} {
  const [permission, setPermission] = useState<DesktopPermission>(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [pending, setPending] = useState<"enabling" | "disabling" | null>(null);
  const [error, setError] = useState<"cap" | "generic" | null>(null);

  const standaloneMedia = useMediaQuery("(display-mode: standalone)");
  const standalone =
    standaloneMedia ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  useEffect(() => {
    let active = true;
    void readPushSubscription().then((subscription) => {
      if (!active) return;
      setHasSubscription(subscription != null);
    });
    return () => {
      active = false;
    };
  }, []);

  const enable = useCallback(() => {
    setPending("enabling");
    setError(null);
    void enablePush().then(async (result: PushEnableResult) => {
      const livePermission: DesktopPermission =
        "Notification" in window ? Notification.permission : "unsupported";
      setPermission(livePermission);
      const subscription = await readPushSubscription();
      setHasSubscription(subscription != null);
      setPending(null);
      if (livePermission === "denied") {
        setError(null);
      } else if (result.ok) {
        setError(null);
      } else {
        setError(result.error === "too-many-subscriptions" ? "cap" : "generic");
      }
    });
  }, []);

  const disable = useCallback(() => {
    setPending("disabling");
    setError(null);
    void disablePush().then(async (ok) => {
      const subscription = await readPushSubscription();
      setHasSubscription(subscription != null);
      setPending(null);
      if (!ok) setError("generic");
    });
  }, []);

  let state: PushRowState;
  if (isIOSDevice() && !standalone) {
    state = "ios-needs-install";
  } else if (!isPushSupported()) {
    state = "unsupported";
  } else if (pending === "enabling") {
    state = "enabling";
  } else if (pending === "disabling") {
    state = "disabling";
  } else if (permission === "denied") {
    state = "denied";
  } else if (permission === "granted" && hasSubscription === true) {
    state = "enabled";
  } else {
    state = "default";
  }

  return { state, error, enable, disable };
}

interface NotificationsTabSectionProps {
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
}

function NotificationsTabSection({
  soundEnabled,
  onToggleSound,
}: NotificationsTabSectionProps) {
  const { status, request } = useDesktopPermission();
  const [soundFocus, setSoundFocus] = useState(false);
  const push = usePushSubscription();

  return (
    <div style={remoteSectionStyle}>
      <div style={remoteFieldBlockStyle}>
        <Field>Desktop notifications</Field>
        {status === "granted" && (
          <RemoteStatusRow
            color="var(--status-ok)"
            text="Enabled. You'll get a system notification when a card needs your input or an agent finishes."
          />
        )}
        {status === "denied" && (
          <RemoteStatusRow
            color="var(--status-down)"
            text="Blocked. Enable notifications for this site in your browser settings."
          />
        )}
        {status === "unsupported" && (
          <span style={remoteHelperTextStyle}>
            Not supported in this browser.
          </span>
        )}
        {status === "default" && (
          <>
            <span style={remoteBodyTextStyle}>
              Get a system notification when a card needs your input or an agent
              finishes.
            </span>
            <div>
              <Button variant="secondary" onClick={request}>
                Enable notifications
              </Button>
            </div>
          </>
        )}
      </div>

      <div style={remoteFieldBlockStyle}>
        <Field>Sound</Field>
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
            checked={soundEnabled}
            onChange={() => onToggleSound(!soundEnabled)}
            onFocus={(e) =>
              setSoundFocus(e.currentTarget.matches(":focus-visible"))
            }
            onBlur={() => setSoundFocus(false)}
            style={{
              accentColor: "var(--accent)",
              borderRadius: "var(--radius)",
              ...focusRing(soundFocus),
              flex: "0 0 auto",
            }}
          />
          <span style={remoteBodyTextStyle}>
            Play a gentle chime for the same moments
          </span>
        </label>
        <div>
          <Button variant="secondary" onClick={() => playChime()}>
            Test sound
          </Button>
        </div>
      </div>

      <div style={remoteFieldBlockStyle}>
        {push.state === "ios-needs-install" ? (
          <Field>Add to your Home Screen to enable push</Field>
        ) : (
          <Field>Push notifications (this device)</Field>
        )}
        {push.state === "ios-needs-install" && (
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <li style={remoteBodyTextStyle}>
              1. Tap the Share icon in Safari's toolbar.
            </li>
            <li style={remoteBodyTextStyle}>2. Tap "Add to Home Screen".</li>
            <li style={remoteBodyTextStyle}>
              3. Open Dispatch from your Home Screen.
            </li>
            <li style={remoteBodyTextStyle}>
              4. Enable push notifications from Settings there.
            </li>
          </ol>
        )}
        {push.state === "unsupported" && (
          <span style={remoteHelperTextStyle}>
            Not supported in this browser.
          </span>
        )}
        {push.state === "default" && (
          <>
            <span style={remoteBodyTextStyle}>
              {
                "Get a push notification when a card needs your input, even with the tab closed."
              }
            </span>
            <div>
              <Button variant="secondary" onClick={push.enable}>
                Enable push notifications
              </Button>
            </div>
          </>
        )}
        {push.state === "enabling" && (
          <div>
            <Button variant="secondary" loading disabled>
              Enabling...
            </Button>
          </div>
        )}
        {push.state === "enabled" && (
          <>
            <RemoteStatusRow
              color="var(--status-ok)"
              text="Push enabled - this device will get a push notification when a card needs your input, even with the tab closed."
            />
            <div>
              <Button variant="secondary" onClick={push.disable}>
                Disable push notifications
              </Button>
            </div>
          </>
        )}
        {push.state === "disabling" && (
          <>
            <RemoteStatusRow
              color="var(--status-ok)"
              text="Push enabled - this device will get a push notification when a card needs your input, even with the tab closed."
            />
            <div>
              <Button variant="secondary" loading disabled>
                Disabling...
              </Button>
            </div>
          </>
        )}
        {push.state === "denied" && (
          <RemoteStatusRow
            color="var(--status-down)"
            text="Blocked - enable notifications for this site in your browser settings."
          />
        )}
        {push.error != null && (
          <div
            role="alert"
            style={{ ...remoteBodyTextStyle, color: "var(--destructive-text)" }}
          >
            {push.error === "cap"
              ? "This browser already has too many devices subscribed. Remove one from another Settings session first."
              : "Couldn't turn on push, try again."}
          </div>
        )}
      </div>
    </div>
  );
}

interface CleanupTab {
  draftDays: string;
  setDraftDays: Dispatch<SetStateAction<string>>;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  validationError: boolean;
  handleSave: () => Promise<void>;
}

function useCleanupTab(onSaved: () => void): CleanupTab {
  const [draftDays, setDraftDays] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { cleanupDelayDays } = await getCleanupDelay();
        if (!active) return;
        setDraftDays(String(cleanupDelayDays));
      } catch (err) {
        console.error("getCleanupDelay failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const trimmed = draftDays.trim();
  const parsedDays = Number(trimmed);
  const validationError =
    trimmed === "" ||
    !Number.isInteger(parsedDays) ||
    parsedDays < 0 ||
    parsedDays > 90;

  async function handleSave() {
    if (saving || validationError) return;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await saveCleanupDelay(parsedDays);
      if (result.ok) {
        onSaved();
        return;
      }
      setSaveError(true);
    } catch (err) {
      console.error("saveCleanupDelay failed", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return {
    draftDays,
    setDraftDays,
    saving,
    saveError,
    loadError,
    validationError,
    handleSave,
  };
}

interface CleanupTabSectionProps {
  cleanupTab: CleanupTab;
}

function CleanupTabSection({ cleanupTab }: CleanupTabSectionProps) {
  const { draftDays, setDraftDays, saveError, loadError, validationError } =
    cleanupTab;
  const [focused, setFocused] = useState(false);

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
          Couldn't load the cleanup delay. Reopen settings to retry.
        </span>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
        }}
      >
        <Field>Cleanup delay (days)</Field>
        <input
          type="number"
          min={0}
          max={90}
          step={1}
          value={draftDays}
          onChange={(e) => setDraftDays(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Cleanup delay in days"
          style={{
            ...settingsInputStyle,
            width: "96px",
            ...focusRing(focused),
          }}
        />
        <span
          style={{
            fontSize: "var(--font-label)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          0 = clean up immediately when a card reaches Done.
        </span>
        {validationError && (
          <div
            role="alert"
            style={{
              fontSize: "var(--font-label)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-label)",
              color: "var(--destructive-text)",
            }}
          >
            Enter a whole number between 0 and 90.
          </div>
        )}
        {saveError && (
          <Notice
            tone="destructive"
            label="Couldn't save cleanup delay. Try again."
          />
        )}
      </div>
    </>
  );
}

type TerminalDraft = Omit<TerminalAppearance, "fontSize">;

interface TerminalTab {
  draft: TerminalDraft;
  draftFontSize: string;
  setField: <K extends keyof TerminalDraft>(
    key: K,
    value: TerminalDraft[K],
  ) => void;
  setDraftFontSize: Dispatch<SetStateAction<string>>;
  loaded: boolean;
  saving: boolean;
  saveError: string | null;
  loadError: boolean;
  validationError: string | null;
  handleSave: () => Promise<void>;
}

function useTerminalTab(onSaved: () => void): TerminalTab {
  const [draft, setDraft] = useState<TerminalDraft>(
    DEFAULT_TERMINAL_APPEARANCE,
  );
  const [draftFontSize, setDraftFontSize] = useState(
    String(DEFAULT_TERMINAL_APPEARANCE.fontSize),
  );
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = validateTerminalAppearance(
          await getTerminalAppearance(),
        );
        if (!active) return;
        if (!result.ok) throw new Error(result.error);
        setDraft(result.value);
        setDraftFontSize(String(result.value.fontSize));
        setLoaded(true);
      } catch (err) {
        console.error("getTerminalAppearance failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const candidate = { ...draft, fontSize: Number(draftFontSize.trim()) };
  const validation = validateTerminalAppearance(candidate);
  const validationError = validation.ok ? null : validation.error;

  function setField<K extends keyof TerminalDraft>(
    key: K,
    value: TerminalDraft[K],
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    if (savingRef.current || !validation.ok) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    let saved = false;
    try {
      const result = await saveTerminalAppearance(validation.value);
      if (result.ok) saved = true;
      else setSaveError(result.error);
    } catch (err) {
      console.error("saveTerminalAppearance failed", err);
      setSaveError("Couldn't save terminal appearance. Try again.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (!saved) return;
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(TERMINAL_APPEARANCE_CHANNEL);
      channel.postMessage(validation.value);
      channel.close();
    }
    onSaved();
  }

  return {
    draft,
    draftFontSize,
    setField,
    setDraftFontSize,
    loaded,
    saving,
    saveError,
    loadError,
    validationError,
    handleSave,
  };
}

const FONT_FAMILY_LABELS: Record<string, string> = {
  [FONT_FAMILY]: "JetBrains Mono Nerd Font (bundled)",
  monospace: "System monospace",
};

const settingsInputStyle: CSSProperties = {
  height: "32px",
  padding: "0 var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  outline: "none",
};

interface TerminalTabSectionProps {
  terminalTab: TerminalTab;
}

function TerminalTabSection({ terminalTab }: TerminalTabSectionProps) {
  const {
    draft,
    draftFontSize,
    setField,
    setDraftFontSize,
    saveError,
    loadError,
    validationError,
  } = terminalTab;
  const [focused, setFocused] = useState<string | null>(null);
  const [installedFonts] = useState<Set<string>>(() =>
    detectInstalledFonts(TERMINAL_FONT_FAMILIES),
  );
  const field = (name: string) => ({
    onFocus: () => setFocused(name),
    onBlur: () => setFocused(null),
    style: { ...settingsInputStyle, ...focusRing(focused === name) },
  });
  const colorField = (key: "background" | "foreground" | "cursor") => {
    const f = field(key);
    return (
      <input
        type="color"
        value={draft[key]}
        onChange={(e) => setField(key, e.target.value)}
        aria-label={`Terminal ${key} color`}
        {...f}
        style={{ ...f.style, width: "64px", padding: "2px" }}
      />
    );
  };
  const row = (label: string, control: ReactNode, hint?: string) => (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-sm)",
      }}
    >
      <Field>{label}</Field>
      {control}
      {hint && (
        <span
          style={{
            fontSize: "var(--font-label)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          {hint}
        </span>
      )}
    </div>
  );

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
          Couldn't load the terminal appearance. Reopen settings to retry.
        </span>
      )}
      {row("Background color", colorField("background"))}
      {row("Text color", colorField("foreground"))}
      {row("Cursor color", colorField("cursor"))}
      {row(
        "Font family",
        <select
          value={draft.fontFamily}
          onChange={(e) => setField("fontFamily", e.target.value)}
          aria-label="Terminal font family"
          {...field("fontFamily")}
          style={{
            ...field("fontFamily").style,
            width: "100%",
            maxWidth: "280px",
          }}
        >
          {TERMINAL_FONT_FAMILIES.map((name) => (
            <option key={name} value={name}>
              {fontOptionLabel(name, installedFonts, FONT_FAMILY_LABELS)}
            </option>
          ))}
        </select>,
        "Fonts marked not installed fall back to the bundled Nerd Font, which always stays as the fallback so Claude Code's glyphs keep rendering.",
      )}
      {row(
        "Font size (px)",
        <input
          type="number"
          min={TERMINAL_FONT_SIZE_MIN}
          max={TERMINAL_FONT_SIZE_MAX}
          step={1}
          value={draftFontSize}
          onChange={(e) => setDraftFontSize(e.target.value)}
          aria-label="Terminal font size in pixels"
          {...field("fontSize")}
          style={{
            ...field("fontSize").style,
            width: "96px",
            maxWidth: "100%",
          }}
        />,
      )}
      {validationError && (
        <div
          role="alert"
          style={{
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--destructive)",
          }}
        >
          {validationError}
        </div>
      )}
      {saveError && <Notice tone="destructive" label={saveError} />}
    </>
  );
}

interface ModelsTab {
  draftArgs: string;
  setDraftArgs: Dispatch<SetStateAction<string>>;
  loaded: boolean;
  saving: boolean;
  saveError: boolean;
  loadError: boolean;
  handleSave: () => Promise<void>;
}

function useModelsTab(onSaved: () => void): ModelsTab {
  const [draftArgs, setDraftArgs] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { claudeArgs } = await getClaudeArgs();
        if (!active) return;
        setDraftArgs(claudeArgs);
        setLoaded(true);
      } catch (err) {
        console.error("getClaudeArgs failed", err);
        if (!active) return;
        setLoadError(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function handleSave() {
    if (saving || !loaded) return;
    setSaving(true);
    setSaveError(false);
    try {
      const result = await saveClaudeArgs(draftArgs);
      if (result.ok) {
        onSaved();
        return;
      }
      setSaveError(true);
    } catch (err) {
      console.error("saveClaudeArgs failed", err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return {
    draftArgs,
    setDraftArgs,
    loaded,
    saving,
    saveError,
    loadError,
    handleSave,
  };
}

interface ResetLinkProps {
  onClick: () => void;
}

function ResetLink({ onClick }: ResetLinkProps) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocus(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocus(false)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        padding: 0,
        background: "transparent",
        border: "none",
        color: hover || focus ? "var(--text)" : "var(--text-muted)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--font-label)",
        lineHeight: "var(--line-label)",
        cursor: "pointer",
        ...focusRing(focus),
      }}
    >
      <RotateCcw size={12} strokeWidth={2} aria-hidden="true" />
      Reset to default
    </button>
  );
}

interface ModelsTabSectionProps {
  modelsTab: ModelsTab;
}

function ModelsTabSection({ modelsTab }: ModelsTabSectionProps) {
  const { draftArgs, setDraftArgs, saveError, loadError } = modelsTab;
  const [focused, setFocused] = useState(false);

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
          Couldn't load Claude's launch arguments. Reopen settings to retry.
        </span>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-lg)",
          padding: "var(--space-lg)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
          }}
        >
          <Bot size={16} strokeWidth={2} aria-hidden="true" />
          <span
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--font-heading)",
              fontWeight: "var(--weight-semibold)",
              lineHeight: "var(--line-heading)",
              color: "var(--text)",
            }}
          >
            Claude
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <Field>Command</Field>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              color: "var(--text-muted)",
            }}
          >
            claude
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-xs)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Field>Arguments</Field>
            <ResetLink onClick={() => setDraftArgs(DEFAULT_CLAUDE_ARGS)} />
          </div>
          <input
            type="text"
            value={draftArgs}
            onChange={(e) => setDraftArgs(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            spellCheck={false}
            aria-label="Claude launch arguments"
            placeholder={DEFAULT_CLAUDE_ARGS}
            style={{
              height: "32px",
              width: "100%",
              padding: "0 var(--space-sm)",
              background: "var(--surface-column)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-body)",
              lineHeight: "var(--line-body)",
              ...focusRing(focused),
            }}
          />
          <span
            style={{
              fontSize: "var(--font-label)",
              lineHeight: "var(--line-label)",
              color: "var(--text-muted)",
            }}
          >
            Passed to <code>claude</code> every time a session starts, resumes,
            or restarts. Clear this to get Claude's normal permission prompts
            instead of skipping them.
          </span>
        </div>

        {saveError && (
          <Notice
            tone="destructive"
            label="Couldn't save Claude's arguments. Try again."
          />
        )}
      </div>
    </>
  );
}

interface WorkspacesTab {
  folders: string[];
  loading: boolean;
  loadError: boolean;
  addFolder: (path: string) => Promise<string | null>;
  removeFolder: (path: string) => void;
}

function useWorkspacesTab(): WorkspacesTab {
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const { folders: fs } = await getWorkspaceFolders();
        if (!active) return;
        setFolders(fs);
      } catch (err) {
        console.error("getWorkspaceFolders failed", err);
        if (!active) return;
        setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const addFolder = useCallback(
    async (path: string): Promise<string | null> => {
      try {
        const result = await addWorkspaceFolder(path);
        if (!result.ok) return result.error;
        setFolders((prev) => (prev.includes(path) ? prev : [...prev, path]));
        return null;
      } catch (err) {
        console.error("addWorkspaceFolder failed", err);
        return "Couldn't reach the server. Try again.";
      }
    },
    [],
  );

  const removeFolder = useCallback((path: string) => {
    removeWorkspaceFolder(path).catch((err) => {
      console.error("removeWorkspaceFolder failed", err);
    });
    setFolders((prev) => prev.filter((f) => f !== path));
  }, []);

  return { folders, loading, loadError, addFolder, removeFolder };
}

interface WorkspaceRowProps {
  path: string;
  onRemove: () => void;
}

function WorkspaceRow({ path, onRemove }: WorkspaceRowProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        borderRadius: "var(--radius)",
        background: hover ? "var(--surface-card-hover)" : "transparent",
      }}
    >
      <FolderGit2
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
      />
      <span
        style={{
          flex: "1 1 auto",
          minWidth: 0,
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-label)",
          fontWeight: "var(--weight-semibold)",
          lineHeight: "var(--line-label)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {path}
      </span>
      <IconButton aria-label={`Remove workspace ${path}`} onClick={onRemove}>
        <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

interface WorkspacesTabSectionProps {
  workspacesTab: WorkspacesTab;
}

function WorkspacesTabSection({ workspacesTab }: WorkspacesTabSectionProps) {
  const { folders, loading, loadError, addFolder, removeFolder } =
    workspacesTab;

  return (
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
      <WorkspaceAdd
        onAdd={addFolder}
        hint="Add a folder that contains the git repos you start tickets in."
      />

      {loading && (
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: "var(--text-muted)",
          }}
        >
          Loading…
        </span>
      )}

      {!loading && loadError && (
        <Notice
          tone="destructive"
          label="Couldn't load workspaces. Reopen settings to retry."
        />
      )}

      {!loading && !loadError && folders.length === 0 && (
        <div style={{ marginTop: "var(--space-lg)" }}>
          <Notice tone="muted" label="No workspaces yet">
            Add a folder above to start tickets in it.
          </Notice>
        </div>
      )}

      {!loading && !loadError && folders.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {folders.map((f) => (
            <WorkspaceRow key={f} path={f} onRemove={() => removeFolder(f)} />
          ))}
        </div>
      )}
    </div>
  );
}

interface SettingsSection {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "filters", label: "Sync filters", icon: Filter },
  { id: "models", label: "Models", icon: Bot },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "workspaces", label: "Workspaces", icon: FolderGit2 },
  { id: "remote", label: "Remote", icon: Globe },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "cleanup", label: "Cleanup", icon: Trash2 },
];

const SETTINGS_PAGE_LINKS = NAV_ITEMS.filter((item) => item.group === "System");

const navGroupLabelStyle: CSSProperties = {
  padding: "var(--space-sm) var(--space-sm) 0",
  fontSize: "var(--font-micro)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  letterSpacing: "0.04em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const pageStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  display: "flex",
  background: "var(--bg)",
};

const sidebarStyle: CSSProperties = {
  flex: "0 0 auto",
  width: "var(--orca-nav-width)",
  maxWidth: "80vw",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  padding: "var(--space-lg)",
  background: "var(--surface-column)",
  borderRight: "1px solid var(--border)",
  overflowY: "auto",
};

const navListStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const contentColumnStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const contentHeaderStyle: CSSProperties = {
  flex: "0 0 auto",
  padding: "var(--space-xl) var(--space-2xl) var(--space-lg)",
  borderBottom: "1px solid var(--border)",
};

const contentHeadingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-display)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-display)",
  color: "var(--text)",
};

const contentBodyStyle: CSSProperties = {
  flex: "1 1 auto",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  padding: "var(--space-xl) var(--space-2xl)",
  maxWidth: "640px",
  width: "100%",
};

const footerStyle: CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  justifyContent: "flex-end",
  padding: "var(--space-lg) var(--space-2xl)",
  borderTop: "1px solid var(--border)",
};

const navButtonBaseStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  width: "100%",
  padding: "var(--space-sm)",
  border: "none",
  borderRadius: "var(--radius)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  textAlign: "left",
  cursor: "pointer",
  outline: "none",
};

interface SettingsNavItemProps {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}

function SettingsNavItem({
  icon: Icon,
  label,
  active,
  onClick,
}: SettingsNavItemProps) {
  const [hover, setHover] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={(e) => setFocused(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
      style={{
        ...navButtonBaseStyle,
        background: active
          ? "var(--surface-card)"
          : hover
            ? "var(--surface-card-hover)"
            : "transparent",
        color: active ? "var(--text)" : "var(--text-muted)",
        ...focusRing(focused),
      }}
    >
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {label}
    </button>
  );
}

interface SettingsScreenProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  onOpenPage: (page: Page) => void;
  onSaved: () => void;
  tunnelState: TunnelState;
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
}

export function SettingsScreen({
  tab,
  onTabChange,
  onOpenPage,
  onSaved,
  tunnelState,
  soundEnabled,
  onToggleSound,
}: SettingsScreenProps) {
  const filters = useFiltersTab(onSaved);
  const modelsTab = useModelsTab(onSaved);
  const terminalTab = useTerminalTab(onSaved);
  const workspacesTab = useWorkspacesTab();
  const remoteTab = useRemoteTab();
  const cleanupTab = useCleanupTab(onSaved);

  const activeSection =
    SETTINGS_SECTIONS.find((section) => section.id === tab) ??
    SETTINGS_SECTIONS[0];

  return (
    <div style={pageStyle}>
      <nav aria-label="Settings sections" style={sidebarStyle}>
        <div style={navListStyle}>
          {SETTINGS_SECTIONS.map((section) => (
            <SettingsNavItem
              key={section.id}
              icon={section.icon}
              label={section.label}
              active={tab === section.id}
              onClick={() => onTabChange(section.id)}
            />
          ))}
        </div>
        <div style={navListStyle}>
          <div style={navGroupLabelStyle}>Pages</div>
          {SETTINGS_PAGE_LINKS.map((link) => (
            <SettingsNavItem
              key={link.page}
              icon={link.icon}
              label={link.label}
              active={false}
              onClick={() => onOpenPage(link.page)}
            />
          ))}
        </div>
      </nav>

      <div style={contentColumnStyle}>
        <div style={contentHeaderStyle}>
          <h1 style={contentHeadingStyle}>{activeSection.label}</h1>
        </div>

        <div style={contentBodyStyle}>
          {tab === "filters" && <SettingsScreen.FiltersTab filters={filters} />}
          {tab === "models" && (
            <SettingsScreen.ModelsTab modelsTab={modelsTab} />
          )}
          {tab === "terminal" && (
            <SettingsScreen.TerminalTab terminalTab={terminalTab} />
          )}
          {tab === "workspaces" && (
            <SettingsScreen.WorkspacesTab workspacesTab={workspacesTab} />
          )}
          {tab === "remote" && (
            <SettingsScreen.RemoteTab
              tunnelState={tunnelState}
              remoteTab={remoteTab}
            />
          )}
          {tab === "notifications" && (
            <SettingsScreen.NotificationsTab
              soundEnabled={soundEnabled}
              onToggleSound={onToggleSound}
            />
          )}
          {tab === "cleanup" && (
            <SettingsScreen.CleanupTab cleanupTab={cleanupTab} />
          )}
        </div>

        {tab === "filters" && (
          <div style={footerStyle}>
            <Button
              variant="primary"
              onClick={() => void filters.handleSave()}
              disabled={!filters.draft}
              loading={filters.saving}
            >
              {filters.saving ? "Saving filters…" : "Save Filters"}
            </Button>
          </div>
        )}
        {tab === "cleanup" && (
          <div style={footerStyle}>
            <Button
              variant="primary"
              onClick={() => void cleanupTab.handleSave()}
              disabled={cleanupTab.validationError}
              loading={cleanupTab.saving}
            >
              {cleanupTab.saving ? "Saving…" : "Save cleanup delay"}
            </Button>
          </div>
        )}
        {tab === "terminal" && (
          <div style={footerStyle}>
            <Button
              variant="primary"
              onClick={() => void terminalTab.handleSave()}
              disabled={
                !terminalTab.loaded || terminalTab.validationError !== null
              }
              loading={terminalTab.saving}
            >
              {terminalTab.saving ? "Saving…" : "Save terminal appearance"}
            </Button>
          </div>
        )}
        {tab === "models" && (
          <div style={footerStyle}>
            <Button
              variant="primary"
              onClick={() => void modelsTab.handleSave()}
              disabled={!modelsTab.loaded}
              loading={modelsTab.saving}
            >
              {modelsTab.saving ? "Saving…" : "Save"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

SettingsScreen.FiltersTab = FiltersTabSection;
SettingsScreen.ModelsTab = ModelsTabSection;
SettingsScreen.TerminalTab = TerminalTabSection;
SettingsScreen.WorkspacesTab = WorkspacesTabSection;
SettingsScreen.RemoteTab = RemoteTabSection;
SettingsScreen.NotificationsTab = NotificationsTabSection;
SettingsScreen.CleanupTab = CleanupTabSection;
