import { useState, type CSSProperties } from "react";
import {
  Bell,
  Columns3,
  Download,
  FolderGit2,
  Globe,
  Info,
  Palette,
  Plug,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { TunnelState } from "../../../shared/types.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { settingsTabFrom, type SettingsTab } from "../../lib/settings-tab.js";
import { NARROW_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { NAV_ITEMS } from "../nav/index.js";
import type { Page } from "../../lib/route.js";
import { AboutTabSection } from "./AboutTab.js";
import { AboutYouTabSection, useAboutYouTab } from "./AboutYouTab.js";
import {
  TerminalSaveButton,
  TerminalTabSection,
  useTerminalTab,
} from "./AppearanceTab.js";
import {
  BoardTabSection,
  useCleanupTab,
  useModelsTab,
  useRetentionTab,
} from "./BoardTab.js";
import {
  ConnectionsTabSection,
  FiltersSaveButton,
  useFiltersTab,
} from "./ConnectionsTab.js";
import { NotificationsTabSection } from "./NotificationsTab.js";
import { RemoteTabSection, useRemoteTab } from "./RemoteTab.js";
import { UpdatesTabSection, useUpdatesTab } from "./UpdatesTab.js";
import { WorkspacesTabSection, useWorkspacesTab } from "./WorkspacesTab.js";
import { settingsInputStyle } from "./settings-styles.js";

interface SettingsSection {
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
}

const SETTINGS_SECTIONS: SettingsSection[] = [
  { id: "connections", label: "Connections", icon: Plug },
  { id: "board", label: "Board", icon: Columns3 },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "remote", label: "Remote access", icon: Globe },
  { id: "workspaces", label: "Workspaces", icon: FolderGit2 },
  { id: "about-you", label: "About you", icon: UserRound },
  { id: "updates", label: "Updates", icon: Download },
  { id: "about", label: "About", icon: Info },
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

const narrowRailStyle: CSSProperties = {
  flex: "0 0 auto",
  padding: "var(--space-lg) var(--space-lg) 0",
};

const narrowSelectStyle: CSSProperties = {
  ...settingsInputStyle,
  width: "100%",
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
  onRunSetup?: () => Promise<boolean>;
  connectionKey?: number;
  errorsInFeeds: boolean;
  onToggleErrorsInFeeds: (on: boolean) => void;
}

export function SettingsScreen({
  tab,
  onTabChange,
  onOpenPage,
  onSaved,
  tunnelState,
  soundEnabled,
  onToggleSound,
  onRunSetup,
  connectionKey,
  errorsInFeeds,
  onToggleErrorsInFeeds,
}: SettingsScreenProps) {
  const filters = useFiltersTab(onSaved);
  const modelsTab = useModelsTab(onSaved);
  const cleanupTab = useCleanupTab(onSaved);
  const retentionTab = useRetentionTab(onSaved);
  const terminalTab = useTerminalTab(onSaved);
  const workspacesTab = useWorkspacesTab();
  const remoteTab = useRemoteTab();
  const aboutYouTab = useAboutYouTab(onSaved);
  const updatesTab = useUpdatesTab();

  const narrow = useMediaQuery(NARROW_QUERY);
  const [selectFocused, setSelectFocused] = useState(false);
  const activeSection =
    SETTINGS_SECTIONS.find((section) => section.id === tab) ??
    SETTINGS_SECTIONS[0];

  return (
    <div style={narrow ? { ...pageStyle, flexDirection: "column" } : pageStyle}>
      {narrow ? (
        <div style={narrowRailStyle}>
          <select
            aria-label="Settings section"
            value={activeSection.id}
            onChange={(e) => onTabChange(settingsTabFrom(e.target.value))}
            onFocus={(e) =>
              setSelectFocused(e.currentTarget.matches(":focus-visible"))
            }
            onBlur={() => setSelectFocused(false)}
            style={{ ...narrowSelectStyle, ...focusRing(selectFocused) }}
          >
            {SETTINGS_SECTIONS.map((section) => (
              <option key={section.id} value={section.id}>
                {section.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
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
      )}

      <div style={contentColumnStyle}>
        <div style={contentHeaderStyle}>
          <h1 style={contentHeadingStyle}>{activeSection.label}</h1>
        </div>

        <div style={contentBodyStyle}>
          {tab === "connections" && (
            <ConnectionsTabSection
              filters={filters}
              onRunSetup={onRunSetup}
              connectionKey={connectionKey}
              errorsInFeeds={errorsInFeeds}
              onToggleErrorsInFeeds={onToggleErrorsInFeeds}
            />
          )}
          {tab === "board" && (
            <BoardTabSection
              modelsTab={modelsTab}
              cleanupTab={cleanupTab}
              retentionTab={retentionTab}
            />
          )}
          {tab === "appearance" && (
            <TerminalTabSection terminalTab={terminalTab} />
          )}
          {tab === "notifications" && (
            <NotificationsTabSection
              soundEnabled={soundEnabled}
              onToggleSound={onToggleSound}
            />
          )}
          {tab === "remote" && (
            <RemoteTabSection tunnelState={tunnelState} remoteTab={remoteTab} />
          )}
          {tab === "workspaces" && (
            <WorkspacesTabSection workspacesTab={workspacesTab} />
          )}
          {tab === "about-you" && (
            <AboutYouTabSection aboutYouTab={aboutYouTab} />
          )}
          {tab === "updates" && <UpdatesTabSection updatesTab={updatesTab} />}
          {tab === "about" && <AboutTabSection updatesTab={updatesTab} />}
        </div>

        {tab === "connections" && filters.linearConfigured && (
          <div style={footerStyle}>
            <FiltersSaveButton filters={filters} />
          </div>
        )}
        {tab === "appearance" && (
          <div style={footerStyle}>
            <TerminalSaveButton terminalTab={terminalTab} />
          </div>
        )}
      </div>
    </div>
  );
}
