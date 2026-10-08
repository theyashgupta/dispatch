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

export const GITHUB_CONNECTION: ConnectionMeta = {
  source: "github",
  name: "GitHub",
  credentialLabel: "Personal access token",
  steps: [
    "Create a fine-grained or classic token on GitHub.",
    "Give it the repo scope so Dispatch can read pull requests, post reviews and merge.",
    "Paste it here and press Connect, or press Use gh login to reuse the GitHub CLI login.",
    "Dispatch checks it with GitHub before saving it.",
  ],
  scopes: ["repo", "read:org"],
  tokenPageUrl: "https://github.com/settings/tokens",
  footer:
    "Your token is checked against GitHub and stored only in the Dispatch Vault on this machine. With gh login, Dispatch asks gh for the token on each sync and never stores it.",
};

export const SLACK_CONNECTION: ConnectionMeta = {
  source: "slack",
  name: "Slack",
  credentialLabel: "User OAuth token",
  steps: [
    "Create an app from scratch at api.slack.com/apps, in your own workspace.",
    "Under OAuth and Permissions, add the User Token Scopes listed below.",
    "Install the app to your workspace. An admin may need to approve it.",
    "Copy the User OAuth Token (it starts with xoxp-) and paste it here. A bot token (xoxb-) also works but sees only what the bot is in.",
    "Keep the app internal to your workspace. Slack limits distributed apps to one history request a minute.",
  ],
  scopes: [
    "channels:history",
    "channels:read",
    "groups:history",
    "groups:read",
    "im:history",
    "im:read",
    "mpim:history",
    "mpim:read",
    "users:read",
  ],
  tokenPageUrl: "https://api.slack.com/apps",
  footer:
    "Your token is checked against Slack and stored only in the Dispatch Vault on this machine. Dispatch only reads from Slack.",
};

export const SLACK_CONSENT = [
  {
    heading: "Dispatch will read",
    lines: [
      "The channels you pick below.",
      "Your direct messages and group DMs.",
      "The names of the people who wrote them.",
    ],
  },
  {
    heading: "Dispatch will store",
    lines: [
      "Messages that mention you or were sent to you, in board.db on this machine.",
      "Your token, in the Dispatch Vault on this machine.",
    ],
  },
  {
    heading: "Dispatch will never",
    lines: [
      "Post, reply, react or change anything in Slack.",
      "Read a channel you did not pick.",
    ],
  },
] as const;

export const SLACK_THREAD_LIMIT_NOTE =
  "Mentions inside thread replies are not picked up yet.";
export const SENTRY_CONNECTION: ConnectionMeta = {
  source: "sentry",
  name: "Sentry",
  credentialLabel: "User auth token",
  steps: [
    "Open Sentry and go to Settings, then Account, then Personal Tokens.",
    "Create a token with org:read, event:read and event:write.",
    "Paste it here and press Connect. Dispatch checks it with Sentry before saving it.",
  ],
  scopes: ["org:read", "event:read", "event:write"],
  tokenPageUrl: "https://sentry.io/settings/account/api/auth-tokens/",
  footer:
    "Your token is checked against Sentry and stored only in the Dispatch Vault on this machine.",
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
    "For This Mac's Calendar, press Load calendars and pick the ones to show. Press Check access to show the macOS prompt for Dispatch Calendar.",
    "For an iCal URL, copy the secret address in iCal format (Google Calendar: Settings, Integrate calendar) into CALENDAR_ICAL_URL in Settings, Vault.",
    "Press Connect. Dispatch reads the next 48 hours once before it saves.",
  ],
  scopes: [],
  footer:
    "Dispatch reads events from one hour ago to 48 hours ahead on this machine and stores them in board.db. The iCal URL stays in the Dispatch Vault.",
};

export const SOON_CONNECTIONS: { source: string; name: string }[] = [];

export const ALL_CONNECTIONS: { source: string; name: string }[] = [
  { source: LINEAR_CONNECTION.source, name: LINEAR_CONNECTION.name },
  { source: GITHUB_CONNECTION.source, name: GITHUB_CONNECTION.name },
  { source: SENTRY_CONNECTION.source, name: SENTRY_CONNECTION.name },
  { source: SLACK_CONNECTION.source, name: SLACK_CONNECTION.name },
  { source: MEETING_CONNECTION.source, name: MEETING_CONNECTION.name },
  { source: CALENDAR_CONNECTION.source, name: CALENDAR_CONNECTION.name },
  ...SOON_CONNECTIONS,
];
