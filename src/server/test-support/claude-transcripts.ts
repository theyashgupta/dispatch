export const REAL_LOGIN_URL =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload&code_challenge=REDACTED&code_challenge_method=S256&state=REDACTED";

export const REAL_LOGIN_OUTPUT = `Opening browser to sign in…\nIf the browser didn't open, visit: \x1b]8;;${REAL_LOGIN_URL}\x07${REAL_LOGIN_URL}\x1b]8;;\x07\nPaste code here if prompted > `;

export const REAL_INVALID_CODE_OUTPUT =
  "Paste code here if prompted > Invalid code. Please make sure the full code was copied.\n";

export const REAL_AUTH_STATUS_JSON = `{
  "loggedIn": true,
  "authMethod": "claude.ai",
  "apiProvider": "firstParty",
  "analyticsDisabled": false,
  "projectsDirectory": "/Users/someone/.claude/projects",
  "email": "someone@example.com",
  "orgId": "876beadb-c8c2-4059-bd8b-000000000000",
  "orgName": "someone@example.com's Organization",
  "subscriptionType": "max"
}
`;

export const REAL_USAGE_PAYLOAD = {
  five_hour: {
    utilization: 53.0,
    resets_at: "2026-09-01T22:50:00.475282+00:00",
  },
  seven_day: {
    utilization: 11.0,
    resets_at: "2026-09-08T03:00:00.475303+00:00",
  },
  limits: [
    {
      kind: "session",
      group: "session",
      percent: 53,
      severity: "normal",
      resets_at: "2026-09-01T22:50:00.475282+00:00",
      scope: null,
      is_active: true,
    },
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 11,
      severity: "normal",
      resets_at: "2026-09-08T03:00:00.475303+00:00",
      scope: null,
      is_active: false,
    },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 13,
      severity: "normal",
      resets_at: "2026-09-08T03:00:00.475479+00:00",
      scope: { model: { id: null, display_name: "Fable" }, surface: null },
      is_active: false,
    },
  ],
};
