export interface ConnectionMeta {
  source: string;
  name: string;
  credentialLabel: string;
  steps: string[];
  scopes: string[];
  tokenPageUrl: string;
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

export const SOON_CONNECTIONS: { source: string; name: string }[] = [
  { source: "github", name: "GitHub" },
  { source: "slack", name: "Slack" },
  { source: "sentry", name: "Sentry" },
  { source: "meeting", name: "Meetings" },
  { source: "calendar", name: "Calendar" },
];

export const ALL_CONNECTIONS: { source: string; name: string }[] = [
  { source: LINEAR_CONNECTION.source, name: LINEAR_CONNECTION.name },
  ...SOON_CONNECTIONS,
];
