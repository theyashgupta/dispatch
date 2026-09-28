export interface ConnectionMeta {
  source: string;
  name: string;
  credentialLabel: string;
  steps: string[];
  scopes: string[];
  tokenPageUrl?: string;
  footer: string;
}

export const LINEAR_CONNECTION: ConnectionMeta = {
  source: "linear",
  name: "Linear",
  credentialLabel: "Personal API key",
  steps: [
    "Open Linear and go to Settings, then Security and access.",
    "Under Personal API keys, create a key named Dispatch.",
    "Give it read and write access. Write lets Dispatch update ticket status.",
    "Paste it here and press Connect. Dispatch checks it with Linear before saving it.",
  ],
  scopes: ["read", "write"],
  tokenPageUrl: "https://linear.app/settings/account/security",
  footer:
    "Your key is checked against Linear and stored only in ~/.dispatch/config.json on this machine.",
};

export const MEETING_CONNECTION: ConnectionMeta = {
  source: "meeting",
  name: "Granola",
  credentialLabel: "No key. Uses your Claude Code login.",
  steps: [
    "Connect Granola to Claude Code: add the Granola connector in claude.ai under Settings, Connectors.",
    "Press Check connection. Dispatch runs claude mcp list and looks for a connected Granola server.",
    "Turn on Enabled. Once an hour Dispatch asks Claude for your action items from recent meetings.",
  ],
  scopes: [],
  footer:
    "Dispatch runs Claude Code on this machine with only the Granola tool allowed. Each round uses your Claude plan. Action items are stored in board.db on this machine.",
};

export const CALENDAR_CONNECTION: ConnectionMeta = {
  source: "calendar",
  name: "Calendar",
  credentialLabel: "This Mac's Calendar or a secret iCal URL",
  steps: [
    "Choose This Mac's Calendar to read the calendars on this Mac, or iCal URL for a secret calendar address.",
    "For This Mac's Calendar, press Load calendars and pick the ones to show. macOS asks once for access to your calendars.",
    "For an iCal URL, copy the secret address in iCal format (Google Calendar: Settings, Integrate calendar) into CALENDAR_ICAL_URL in Settings, Vault.",
    "Press Connect. Dispatch reads the next 48 hours once before it saves.",
  ],
  scopes: [],
  footer:
    "Dispatch reads events from one hour ago to 48 hours ahead on this machine and stores them in board.db. The iCal URL stays in the Dispatch Vault.",
};
