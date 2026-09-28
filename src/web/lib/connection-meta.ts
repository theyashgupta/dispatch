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
