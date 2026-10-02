import { useState } from "react";
import type { SlackChannel } from "../../../../shared/types.js";
import { SlackChannelPicker } from "@/modules/connections/components/SlackChannelPicker";
import {
  addChannelRow,
  addPicked,
  mergeChannelRows,
  type SlackChannelRow,
  type SlackSetupFailure,
} from "@/modules/connections/domain/slack-channels";
import {
  useResolveSlackChannelMutation,
  useSaveSlackChannelsMutation,
  useSavedSlackChannelsQuery,
  useSlackChannelsQuery,
} from "@/modules/connections/queries/connections-queries";

interface SlackChannelsContainerProps {
  enabled: boolean;
}

export function SlackChannelsContainer({
  enabled,
}: SlackChannelsContainerProps) {
  const savedQuery = useSavedSlackChannelsQuery();
  const listQuery = useSlackChannelsQuery(enabled);
  const save = useSaveSlackChannelsMutation();
  const resolve = useResolveSlackChannelMutation();
  const [picked, setPicked] = useState<SlackChannel[]>([]);
  const [loadedSaved, setLoadedSaved] = useState<SlackChannel[] | undefined>();
  const [added, setAdded] = useState<SlackChannel[]>([]);
  const [addError, setAddError] = useState<SlackSetupFailure | null>(null);

  if (savedQuery.data !== loadedSaved) {
    setLoadedSaved(savedQuery.data);
    if (savedQuery.data) setPicked(savedQuery.data);
  }

  const saved = savedQuery.data ?? [];
  const listed = enabled ? listQuery.data : undefined;
  const rows: SlackChannelRow[] = added.reduce(
    addChannelRow,
    mergeChannelRows(listed?.ok ? listed.channels : [], saved),
  );

  const toggle = (row: SlackChannelRow) =>
    setPicked((prev) =>
      prev.some((c) => c.id === row.id)
        ? prev.filter((c) => c.id !== row.id)
        : addPicked(prev, row),
    );

  const add = async (input: string): Promise<boolean> => {
    setAddError(null);
    const result = await resolve.mutateAsync(input);
    if (!result.ok) {
      setAddError(result.reason);
      return false;
    }
    const channel = { id: result.id, name: result.name };
    setPicked((prev) => addPicked(prev, channel));
    setAdded((prev) => [...prev, channel]);
    return true;
  };

  return (
    <SlackChannelPicker
      enabled={enabled}
      saved={saved}
      picked={picked}
      rows={rows}
      truncated={listed?.ok === true && listed.truncated}
      listFailure={listed && !listed.ok ? listed.reason : null}
      loadFailed={savedQuery.isError}
      addError={addError}
      saveFailed={save.data === null}
      busy={save.isPending}
      onToggle={toggle}
      onAdd={add}
      onClearAddError={() => setAddError(null)}
      onSave={() => save.mutate(picked)}
    />
  );
}
