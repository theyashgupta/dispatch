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
