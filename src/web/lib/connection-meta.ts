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
