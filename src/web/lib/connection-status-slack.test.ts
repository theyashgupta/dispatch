import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cardStatusFrom,
  existingCredentialLabel,
  SLACK_BOT_NOTE,
  SLACK_ERROR_COPY,
  slackSaidLine,
} from "./connection-status.js";
import {
  SLACK_CONNECTION,
  SLACK_CONSENT,
  SLACK_THREAD_LIMIT_NOTE,
} from "./connection-meta.js";

test("a connected Slack report shows the user and workspace label", () => {
  assert.deepEqual(
    cardStatusFrom(
      {
        configured: true,
        connected: true,
        enabled: true,
        via: "vault",
        tokenKind: "user",
        account: "g6-tester @ Acme",
      },
      SLACK_ERROR_COPY,
    ),
    { kind: "connected", account: "g6-tester @ Acme" },
  );
});

test("a rejected Slack report shows the Slack rejected copy", () => {
  assert.deepEqual(
    cardStatusFrom(
      {
        configured: true,
        connected: false,
        error: "rejected",
        providerError: "token_revoked",
      },
      SLACK_ERROR_COPY,
    ),
    {
      kind: "error",
      message:
        "Slack rejected that token. Paste a user token (xoxp-) or a bot token (xoxb-).",
    },
  );
});

test("an unreachable report shows the Slack unreachable copy", () => {
  assert.equal(
    SLACK_ERROR_COPY.unreachable,
    "Couldn't reach Slack. Check your connection and try again.",
  );
});

test("the Slack said line quotes only a plain lowercase code", () => {
  assert.equal(slackSaidLine("token_revoked"), "Slack said: token_revoked.");
  assert.equal(slackSaidLine("invalid_auth"), "Slack said: invalid_auth.");
  assert.equal(slackSaidLine("<b>x</b>"), null);
  assert.equal(slackSaidLine(""), null);
  assert.equal(slackSaidLine(null), null);
  assert.equal(slackSaidLine(undefined), null);
});

test("the Vault token button shows only while Slack is off and a token is stored", () => {
  assert.equal(
    existingCredentialLabel({
      configured: true,
      connected: false,
      enabled: false,
      via: "vault",
    }),
    "Use the Vault token",
  );
  assert.equal(
    existingCredentialLabel({
      configured: true,
      connected: true,
      enabled: true,
      via: "vault",
    }),
    undefined,
  );
  assert.equal(
    existingCredentialLabel({ configured: false, connected: false }),
    undefined,
  );
});

test("the bot note and the Slack copy are the recorded text", () => {
  assert.equal(
    SLACK_BOT_NOTE,
    "Bot token: Dispatch sees only mentions of the bot and channels it was invited to. A user token sees your own DMs and mentions.",
  );
  assert.equal(
    SLACK_THREAD_LIMIT_NOTE,
    "Mentions inside thread replies are not picked up yet.",
  );
  assert.equal(SLACK_CONNECTION.credentialLabel, "User OAuth token");
  assert.equal(SLACK_CONNECTION.scopes.length, 9);
  assert.deepEqual(
    SLACK_CONSENT.map((g) => g.heading),
    ["Dispatch will read", "Dispatch will store", "Dispatch will never"],
  );
  assert.ok(
    SLACK_CONSENT[2].lines.includes(
      "Post, reply, react or change anything in Slack.",
    ),
  );
});
