import { useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import { ARCHIVE_RETENTION_MAX_DAYS } from "../../../../shared/types.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { NumberSettingSection } from "@/components/NumberSettingSection";
import { PageHeaderCount } from "@/components/PageHeaderCount";
import { ArchiveSection } from "@/modules/archive/components/ArchiveSection";
import {
  IDLE_ROW,
  type ArchiveRowState,
} from "@/modules/archive/domain/archive-row-state";
import {
  useArchiveQuery,
  useDeleteArchivedMutation,
  useRestoreArchivedMutation,
} from "@/modules/archive/queries/archive-queries";
import { useArchiveRetentionDraft } from "@/queries/archive-retention-queries";

export function ArchiveContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const archive = useArchiveQuery(useAppStore(appStore, (s) => s.board));
  const restore = useRestoreArchivedMutation();
  const remove = useDeleteArchivedMutation();
  const retention = useArchiveRetentionDraft();
  const [rowState, setRowState] = useState<Record<string, ArchiveRowState>>({});

  const patchRow = (id: string, patch: Partial<ArchiveRowState>) =>
    setRowState((prev) => {
      const base = prev[id] ?? IDLE_ROW;
      return { ...prev, [id]: { ...base, ...patch } };
    });

  const run = async (
    id: string,
    call: () => Promise<{ ok: true } | { ok: false; error: string }>,
    fallback: string,
  ) => {
    patchRow(id, { busy: true, error: null });
    try {
      const result = await call();
      if (!result.ok) patchRow(id, { busy: false, error: result.error });
    } catch {
      patchRow(id, { busy: false, error: fallback });
    }
  };

  const handleRestore = (id: string) =>
    run(id, () => restore.mutateAsync(id), "Couldn't restore this group.");

  const handleDelete = (id: string, force: boolean) =>
    run(
      id,
      () => remove.mutateAsync({ id, force }),
      "Couldn't delete this group.",
    );

  return (
    <ArchiveSection
      rows={archive.data ?? null}
      loadError={archive.isError || retention.loadError}
      rowState={rowState}
      onRestore={(id) => void handleRestore(id)}
      onDelete={(id, force) => void handleDelete(id, force)}
    >
      <NumberSettingSection
        id="archive-retention"
        label="Archive retention (days)"
        ariaLabel="Archive retention in days"
        max={ARCHIVE_RETENTION_MAX_DAYS}
        hint="Unwound groups keep their worktrees on disk until you delete them or this many days pass. 0 = never delete automatically."
        value={retention.draft}
        invalid={retention.invalid}
        invalidText={`Enter a whole number between 0 and ${ARCHIVE_RETENTION_MAX_DAYS}.`}
        saveErrorText={retention.saveErrorText}
        saveLabel="Save retention"
        saving={retention.saving}
        savedText={retention.saved ? "Saved." : undefined}
        buttonVariant="secondary"
        inlineAction
        onChange={retention.change}
        onSave={retention.save}
      />
    </ArchiveSection>
  );
}

export function ArchiveHeaderContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const count = useArchiveQuery(useAppStore(appStore, (s) => s.board)).data
    ?.length;
  return count != null ? <PageHeaderCount count={count} /> : null;
}
