import { useId, useState, type CSSProperties } from "react";
import {
  INBOX_ACTIONS,
  isWebUrl,
  runAction,
  snoozeRow,
  type ActionContext,
  type ActionServices,
  type InboxActionId,
} from "../../lib/actions.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import {
  slackAuthor,
  slackPills,
  type SlackRow,
} from "../../lib/slack-rows.js";
import { SNOOZE_LABELS, SNOOZE_PRESETS } from "../../lib/snooze.js";
import { Button } from "../../primitives/Button.js";
import { Chip } from "../../primitives/Chip.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { SlackThread } from "./SlackThread.js";

interface SlackDetailProps {
  row: SlackRow | null;
  services: ActionServices;
  onBack?: () => void;
  onLeave?: (id: string) => void;
}

const paneStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-lg)",
  flex: "1 1 auto",
  minWidth: 0,
  minHeight: 0,
  overflowY: "auto",
  padding: "var(--space-lg)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "var(--font-heading)",
  lineHeight: "var(--line-heading)",
  fontWeight: "var(--weight-semibold)",
  color: "var(--text)",
  overflowWrap: "anywhere",
};

const metaRowStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "var(--space-sm)",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
  minWidth: 0,
};

const messageStyle: CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  color: "var(--text)",
};

const linkStyle: CSSProperties = {
  color: "var(--text)",
  textDecoration: "underline",
  alignSelf: "flex-start",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-sm)",
};

const emptyStyle: CSSProperties = {
  padding: "var(--space-3xl) var(--space-lg)",
  textAlign: "center",
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const DETAIL_ACTIONS: [InboxActionId, string][] = [
  ["draftReply", "Draft reply"],
  ["promote", "Promote to ticket"],
  ["snooze", "Snooze"],
  ["done", "Done"],
  ["copyLink", "Copy link"],
];

function place(conversation: string | undefined, channelName: string) {
  if (conversation === "im") return "in a DM";
  if (conversation === "mpim") return "in a group DM";
  return `in #${channelName}`;
}

export function SlackDetail({
  row,
  services,
  onBack,
  onLeave,
}: SlackDetailProps) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [linkFocused, setLinkFocused] = useState(false);
  const snoozeGroupId = useId();
  if (!row) {
    return (
      <div style={paneStyle}>
        <div style={emptyStyle}>Pick a message to see it here.</div>
      </div>
    );
  }
  const item = row.item;
  const { meta } = item;
  const ctx: ActionContext = {
    ...services,
    api: {
      ...services.api,
      promoteItem: async (id) => {
        const result = await services.api.promoteItem(id);
        services.notice(`Created ${result.card.identifier}`);
        return result;
      },
    },
    openSnooze: () => setSnoozeOpen((open) => !open),
  };
  const actions = DETAIL_ACTIONS.flatMap(([id, label]) =>
    INBOX_ACTIONS.filter((a) => a.id === id && a.appliesTo(row)).map(
      (action) => ({ action, label }),
    ),
  );

  return (
    <div style={paneStyle} data-testid="slack-detail">
      {onBack && (
        <div>
          <Button variant="secondary" onClick={onBack}>
            Back
          </Button>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
          minWidth: 0,
        }}
      >
        <h2 style={titleStyle}>{slackAuthor(item)}</h2>
        <div style={metaRowStyle}>
          <span style={{ overflowWrap: "anywhere" }}>
            {place(meta.conversation, meta.channelName ?? "")}
          </span>
          <span title={item.createdAt}>
            {formatAge(item.createdAt, nowMs())}
          </span>
          {slackPills(item).map((pill) => (
            <Chip
              key={pill.label}
              tone={pill.tone}
              title={pill.label}
              style={{ maxWidth: "240px" }}
            >
              {pill.label}
            </Chip>
          ))}
        </div>
      </div>
      <p style={messageStyle}>{item.snippet}</p>
      {isWebUrl(item.url) && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onFocus={(event) =>
            setLinkFocused(event.currentTarget.matches(":focus-visible"))
          }
          onBlur={() => setLinkFocused(false)}
          style={{ ...linkStyle, ...focusRing(linkFocused) }}
        >
          Open in Slack
        </a>
      )}
      {meta.threadTs ? (
        <SlackThread itemId={item.id} replyCount={meta.replyCount} />
      ) : null}
      <div style={actionsStyle}>
        {actions.map(({ action, label }) => (
          <Button
            key={action.id}
            variant={action.id === "draftReply" ? "primary" : "secondary"}
            aria-expanded={action.id === "snooze" ? snoozeOpen : undefined}
            aria-controls={action.id === "snooze" ? snoozeGroupId : undefined}
            onClick={() =>
              void runAction(action, ctx, row).then((ok) => {
                if (ok && (action.id === "promote" || action.id === "done")) {
                  onLeave?.(row.id);
                }
              })
            }
          >
            {label}
          </Button>
        ))}
      </div>
      {snoozeOpen && (
        <div
          id={snoozeGroupId}
          style={actionsStyle}
          role="group"
          aria-label="Snooze for"
        >
          {SNOOZE_PRESETS.map((preset) => (
            <Button
              key={preset}
              variant="secondary"
              onClick={() => {
                setSnoozeOpen(false);
                void snoozeRow(ctx, row, preset, new Date()).then((ok) => {
                  if (ok) onLeave?.(row.id);
                });
              }}
            >
              {SNOOZE_LABELS[preset]}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
