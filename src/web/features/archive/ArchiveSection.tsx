import { useEffect, useState, type CSSProperties } from "react";
import type { ArchivedGroupSummary } from "../../../shared/types.js";
import {
  deleteArchived,
  getArchiveRetention,
  listArchive,
  restoreArchived,
  saveArchiveRetention,
} from "../../lib/api.js";
import { formatAge, nowMs } from "../../lib/format-age.js";
import { Button } from "../../primitives/Button.js";
import { Field } from "../../primitives/Field.js";
import { Notice } from "../../primitives/Notice.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { ARCHIVE_RETENTION_MAX_DAYS } from "../../../shared/types.js";
import { parseArchiveRetention } from "./archive-retention.js";

interface ArchiveSectionProps {
  inputStyle: CSSProperties;
}

interface RowState {
  busy: boolean;
  error: string | null;
}

export function ArchiveSection({ inputStyle }: ArchiveSectionProps) {
  const [rows, setRows] = useState<ArchivedGroupSummary[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [draftDays, setDraftDays] = useState("");
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [retentionSaved, setRetentionSaved] = useState(false);
  const [focused, setFocused] = useState(false);

  async function reload(): Promise<void> {
    try {
      setRows(await listArchive());
      setLoadError(false);
    } catch (err) {
      console.error("listArchive failed", err);
      setLoadError(true);
    }
  }

  useEffect(() => {
    let live = true;
    void listArchive()
      .then((r) => {
        if (live) setRows(r);
      })
      .catch((err: unknown) => {
        console.error("listArchive failed", err);
        if (live) setLoadError(true);
      });
    void getArchiveRetention()
      .then(({ archiveRetentionDays }) => {
        if (live) setDraftDays(String(archiveRetentionDays));
      })
      .catch((err: unknown) => {
        console.error("getArchiveRetention failed", err);
        if (live) setLoadError(true);
      });
    return () => {
      live = false;
    };
  }, []);

  const parsedDays = parseArchiveRetention(draftDays);

  async function handleSaveRetention(): Promise<void> {
    if (parsedDays === null || retentionSaving) return;
    setRetentionSaving(true);
    setRetentionError(null);
    setRetentionSaved(false);
    try {
      const result = await saveArchiveRetention(parsedDays);
      if (result.ok) setRetentionSaved(true);
      else setRetentionError(result.error);
    } catch (err) {
      console.error("saveArchiveRetention failed", err);
      setRetentionError("Couldn't save archive retention. Try again.");
    } finally {
      setRetentionSaving(false);
    }
  }

  function patchRow(id: string, patch: Partial<RowState>): void {
    setRowState((prev) => {
      const base = prev[id] ?? { busy: false, error: null };
      return { ...prev, [id]: { ...base, ...patch } };
    });
  }

  async function handleRestore(id: string): Promise<void> {
    patchRow(id, { busy: true, error: null });
    try {
      const result = await restoreArchived(id);
      if (!result.ok) {
        patchRow(id, { busy: false, error: result.error });
        return;
      }
    } catch (err) {
      console.error("restoreArchived failed", err);
      patchRow(id, { busy: false, error: "Couldn't restore this group." });
      return;
    }
    await reload();
  }

  async function handleDelete(id: string, force: boolean): Promise<void> {
    patchRow(id, { busy: true, error: null });
    try {
      const result = await deleteArchived(id, force);
      if (!result.ok) {
        patchRow(id, { busy: false, error: result.error });
        await reload();
        return;
      }
    } catch (err) {
      console.error("deleteArchived failed", err);
      patchRow(id, { busy: false, error: "Couldn't delete this group." });
      return;
    }
    await reload();
  }

  return (
    <div
      data-testid="archive-section"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-md)",
      }}
    >
      <Field section>Archived groups</Field>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-sm)",
        }}
      >
        <Field>Archive retention (days)</Field>
        <div
          style={{
            display: "flex",
            gap: "var(--space-sm)",
            alignItems: "center",
          }}
        >
          <input
            type="number"
            min={0}
            max={ARCHIVE_RETENTION_MAX_DAYS}
            step={1}
            value={draftDays}
            onChange={(e) => {
              setDraftDays(e.target.value);
              setRetentionSaved(false);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            aria-label="Archive retention in days"
            style={{ ...inputStyle, width: "96px", ...focusRing(focused) }}
          />
          <Button
            variant="secondary"
            disabled={parsedDays === null || retentionSaving}
            onClick={() => void handleSaveRetention()}
          >
            {retentionSaving ? "Saving…" : "Save retention"}
          </Button>
          {retentionSaved && (
            <span style={mutedStyle} role="status">
              Saved.
            </span>
          )}
        </div>
        <span style={mutedStyle}>
          Unwound groups keep their worktrees on disk until you delete them or
          this many days pass. 0 = never delete automatically.
        </span>
        {parsedDays === null && (
          <div role="alert" style={alertStyle}>
            Enter a whole number between 0 and {ARCHIVE_RETENTION_MAX_DAYS}.
          </div>
        )}
        {retentionError && <Notice tone="destructive" label={retentionError} />}
      </div>

      {loadError && (
        <Notice
          tone="destructive"
          label="Couldn't load the archive. Reopen settings to retry."
        />
      )}
      {!loadError && rows.length === 0 && (
        <span style={mutedStyle}>
          No archived groups. Unwind a group to see it here.
        </span>
      )}
      {rows.map((row) => {
        const state = rowState[row.id] ?? { busy: false, error: null };
        const blocked = row.deleteBlocked != null;
        const reason = state.error ?? row.deleteBlocked ?? null;
        return (
          <div
            key={row.id}
            data-testid={`archived-${row.identifier}`}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
              padding: "var(--space-sm) var(--space-md)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius)",
              background: "var(--surface-card)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "var(--space-sm)",
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontWeight: "var(--weight-semibold)" }}>
                {row.identifier}
              </span>
              <span
                style={{
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {row.title}
              </span>
              <span style={mutedStyle}>
                {formatAge(row.archivedAt, nowMs())}
              </span>
            </div>
            <span style={mutedStyle}>
              {row.members.map((m) => m.identifier).join(", ")} sent to{" "}
              {row.destination === "inbox" ? "Inbox" : "To Do"}
            </span>
            {reason && (
              <div role="alert" style={alertStyle}>
                {reason}
              </div>
            )}
            <div
              style={{
                display: "flex",
                gap: "var(--space-sm)",
                flexWrap: "wrap",
              }}
            >
              <Button
                variant="primary"
                disabled={state.busy}
                onClick={() => void handleRestore(row.id)}
              >
                Restore
              </Button>
              <Button
                variant="danger"
                disabled={state.busy}
                onClick={() => void handleDelete(row.id, false)}
              >
                Delete
              </Button>
              {blocked && (
                <Button
                  variant="danger"
                  disabled={state.busy}
                  onClick={() => void handleDelete(row.id, true)}
                >
                  Delete anyway
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const mutedStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const alertStyle: CSSProperties = {
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--destructive-text)",
};
