import { useState } from "react";
import {
  SESSION_SECTIONS,
  type SessionFilter,
  type SessionSection,
} from "../../lib/sessions.js";
import { Button } from "../../primitives/Button.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Select } from "../../primitives/Select.js";

interface SessionsToolbarProps {
  filter: SessionFilter;
  accounts: string[];
  onChange: (filter: SessionFilter) => void;
}

const STATUS_LABELS = Object.fromEntries([
  ["", "All statuses"],
  ...SESSION_SECTIONS.map((section) => [section, section]),
]) as Record<SessionSection | "", string>;

export function SessionsToolbar({
  filter,
  accounts,
  onChange,
}: SessionsToolbarProps) {
  const [searchFocus, setSearchFocus] = useState(false);
  const accountLabels = Object.fromEntries([
    ["", "All accounts"],
    ...accounts.map((account) => [account, account]),
  ]) as Record<string, string>;

  return (
    <div
      style={{
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-lg)",
        borderBottom: "1px solid var(--border)",
        background: "var(--surface-column)",
      }}
    >
      <input
        type="text"
        value={filter.query}
        onChange={(e) => onChange({ ...filter, query: e.target.value })}
        onFocus={(event) =>
          setSearchFocus(event.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setSearchFocus(false)}
        placeholder="Search sessions…"
        aria-label="Search sessions"
        style={{
          width: "220px",
          maxWidth: "100%",
          height: "32px",
          boxSizing: "border-box",
          padding: "0 var(--space-sm)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--text)",
          fontFamily: "var(--font-ui)",
          fontSize: "var(--font-body)",
          lineHeight: "var(--line-body)",
          outline: "none",
          ...focusRing(searchFocus),
          flex: "0 0 auto",
        }}
      />
      <Button
        variant="secondary"
        aria-pressed={filter.liveOnly}
        onClick={() => onChange({ ...filter, liveOnly: !filter.liveOnly })}
      >
        Live only
      </Button>
      <Select
        label="Account"
        value={filter.account}
        labels={accountLabels}
        onChange={(account) => onChange({ ...filter, account })}
      />
      <Select
        label="Status"
        value={filter.status}
        labels={STATUS_LABELS}
        onChange={(status) => onChange({ ...filter, status })}
      />
    </div>
  );
}
