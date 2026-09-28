import { useEffect, useState } from "react";
import type { SlackChannel } from "../../shared/types.js";
import {
  getSavedSlackChannels,
  listSlackChannels,
  resolveSlackChannel,
  saveSlackChannels,
  type SlackSetupFailure,
} from "../lib/api.js";
import {
  addChannelRow,
  addPicked,
  mergeChannelRows,
  type SlackChannelRow,
} from "../lib/slack-channels.js";

export interface SlackChannelsState {
  saved: SlackChannel[];
  picked: SlackChannel[];
  rows: SlackChannelRow[];
  truncated: boolean;
  listFailure: SlackSetupFailure | null;
  loadFailed: boolean;
  addError: SlackSetupFailure | null;
  saveFailed: boolean;
  busy: boolean;
  toggle: (row: SlackChannelRow) => void;
  add: (input: string) => Promise<boolean>;
  clearAddError: () => void;
  save: () => Promise<void>;
}

/**
 * The Slack picker's data: the saved list, the picks, the listed rows, and the add and save actions.
 *
 * @remarks Loads once per mount and again when the Slack switch flips, never on a timer. The channel
 * list is asked for only while the switch is on; a failed saved-list read sets `loadFailed` so the
 * picker never overwrites a list it could not read.
 */
export function useSlackChannels(enabled: boolean): SlackChannelsState {
  const [saved, setSaved] = useState<SlackChannel[]>([]);
  const [picked, setPicked] = useState<SlackChannel[]>([]);
  const [rows, setRows] = useState<SlackChannelRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [listFailure, setListFailure] = useState<SlackSetupFailure | null>(
    null,
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [addError, setAddError] = useState<SlackSetupFailure | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await getSavedSlackChannels().catch(() => null);
      if (!live) return;
      setLoadFailed(stored === null);
      setListFailure(null);
      setTruncated(false);
      setAddError(null);
      setSaveFailed(false);
      setSaved(stored ?? []);
      setPicked(stored ?? []);
      setRows(mergeChannelRows([], stored ?? []));
      if (!enabled) return;
      const listed = await listSlackChannels();
      if (!live) return;
      if (listed.ok) {
        setRows(mergeChannelRows(listed.channels, stored ?? []));
        setTruncated(listed.truncated);
      } else {
        setListFailure(listed.reason);
      }
    })();
    return () => {
      live = false;
    };
  }, [enabled]);

  const toggle = (row: SlackChannelRow) =>
    setPicked((prev) =>
      prev.some((c) => c.id === row.id)
        ? prev.filter((c) => c.id !== row.id)
        : addPicked(prev, row),
    );

  const add = async (input: string): Promise<boolean> => {
    setAddError(null);
    const result = await resolveSlackChannel(input);
    if (!result.ok) {
      setAddError(result.reason);
      return false;
    }
    const channel = { id: result.id, name: result.name };
    setPicked((prev) => addPicked(prev, channel));
    setRows((prev) => addChannelRow(prev, channel));
    return true;
  };

  const save = async () => {
    setBusy(true);
    setSaveFailed(false);
    const stored = await saveSlackChannels(picked);
    if (stored) {
      setSaved(stored);
      setPicked(stored);
    } else {
      setSaveFailed(true);
    }
    setBusy(false);
  };

  return {
    saved,
    picked,
    rows,
    truncated,
    listFailure,
    loadFailed,
    addError,
    saveFailed,
    busy,
    toggle,
    add,
    clearAddError: () => setAddError(null),
    save,
  };
}
