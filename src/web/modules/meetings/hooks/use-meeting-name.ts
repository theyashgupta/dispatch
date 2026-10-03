import { useState } from "react";

const NAME_KEY = "dsp.meetingName";

function readSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Hold the user's name for the notes form, seeded from the last saved name.
 *
 * @remarks
 * The name is stored as plain text under `dsp.meetingName`, and an empty name removes the key.
 * A blocked storage keeps the form working and saves nothing.
 */
export function useMeetingName(): {
  name: string;
  setName: (name: string) => void;
  save: (name: string) => void;
} {
  const [name, setName] = useState(readSavedName);
  function save(next: string) {
    try {
      if (next === "") localStorage.removeItem(NAME_KEY);
      else localStorage.setItem(NAME_KEY, next);
    } catch {
      return;
    }
  }
  return { name, setName, save };
}
