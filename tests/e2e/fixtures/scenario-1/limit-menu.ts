export const STOP_ROW = "1. Stop and wait for limit to reset";
const WAIT_ROW = "2. Wait here, then continue automatically at 8:30am";
export const CREDITS_ROW = "3. Switch to usage credits";

/** The pane fields that show the usage limit menu with the cursor on the credits row. */
export function limitMenuFields(): Record<string, unknown> {
  return {
    prompt: "",
    transcript: ["❯ /rate-limit-options"],
    dialog: {
      title: "What do you want to do?",
      rows: [STOP_ROW, WAIT_ROW, CREDITS_ROW],
      cursor: 2,
    },
  };
}
