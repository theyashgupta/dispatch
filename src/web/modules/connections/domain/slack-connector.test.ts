import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SLACK_ERROR_COPY,
  cardStatusFrom,
} from "../../../../shared/connection-status.js";
import { SLACK_CONSENT } from "../../../../shared/connection-meta.js";
import type {
  SlackConnectorState,
  SlackMcpStatus,
  SourceConnection,
} from "../../../../shared/types.js";
import {
  SLACK_CONNECTOR_LABEL,
  SLACK_LOAD_FAILED_COPY,
  showsTokenFields,
  slackCardStatus,
  slackConnectorLine,
  slackConsentLines,
  slackRunLine,
} from "./slack-connector.js";

const connection: SourceConnection = {
  connected: true,
  configured: true,
  enabled: true,
  account: "yash",
};

const mcpStatus = (patch: Partial<SlackMcpStatus> = {}): SlackMcpStatus => ({
  mode: "mcp",
  enabled: true,
  running: false,
  connector: "connected",
  server: "claude.ai Slack",
  ...patch,
});

const status = (mcp: SlackMcpStatus | null, loadFailed = false) =>
  slackCardStatus({
    mode: "mcp",
    mcp,
    mcpLoadFailed: loadFailed,
    connection,
  });

test("a connected connector shows connected with the server name", () => {
  assert.deepEqual(status(mcpStatus()), {
    kind: "connected",
    account: "claude.ai Slack",
  });
});

test("the three LOCAL-82 labels are exact", () => {
  assert.equal(SLACK_CONNECTOR_LABEL.connected, "connected");
  assert.equal(SLACK_CONNECTOR_LABEL["needs-auth"], "needs auth");
  assert.equal(SLACK_CONNECTOR_LABEL["not-found"], "not found");
  assert.equal(SLACK_CONNECTOR_LABEL.failed, "failed");
  assert.equal(
    SLACK_CONNECTOR_LABEL["claude-missing"],
    "Claude Code not found",
  );
});

test("each connector problem is an error whose message holds its label", () => {
  const problems: Exclude<SlackConnectorState, "connected">[] = [
    "needs-auth",
    "not-found",
    "failed",
    "claude-missing",
  ];
  for (const connector of problems) {
    const result = status(mcpStatus({ connector }));
    assert.equal(result.kind, "error");
    assert.ok(
      result.kind === "error" &&
        result.message.includes(SLACK_CONNECTOR_LABEL[connector]),
    );
  }
});

test("the connector line names the label and is empty before a read", () => {
  assert.equal(slackConnectorLine("needs-auth"), "Slack connector: needs auth");
  assert.equal(slackConnectorLine("connected"), "Slack connector: connected");
  assert.equal(slackConnectorLine(undefined), null);
});

test("an invalid round on a connected connector shows the invalid output copy", () => {
  assert.deepEqual(status(mcpStatus({ lastError: "invalid-output" })), {
    kind: "error",
    message:
      "The last round returned output Dispatch could not read. No item was created.",
  });
});

test("a round error that named a connector state clears once the connector reads connected", () => {
  for (const lastError of [
    "needs-auth",
    "not-found",
    "claude-missing",
  ] as const) {
    assert.deepEqual(status(mcpStatus({ lastError })), {
      kind: "connected",
      account: "claude.ai Slack",
    });
  }
  assert.equal(status(mcpStatus({ lastError: "failed" })).kind, "error");
});

test("a timed out round shows the timeout copy", () => {
  assert.deepEqual(status(mcpStatus({ lastError: "timeout" })), {
    kind: "error",
    message: "The last round took longer than 5 minutes and stopped.",
  });
});

test("Slack off shows off, no status shows checking, a failed read shows an error", () => {
  assert.deepEqual(status(mcpStatus({ enabled: false })), { kind: "off" });
  assert.deepEqual(status(null), { kind: "checking" });
  assert.deepEqual(status(null, true), {
    kind: "error",
    message: SLACK_LOAD_FAILED_COPY,
  });
});

test("token mode is the card of today whatever the connector status says", () => {
  const rejected: SourceConnection = {
    connected: false,
    configured: true,
    enabled: true,
    error: "rejected",
  };
  for (const conn of [connection, rejected]) {
    for (const mcp of [
      mcpStatus({ mode: "token" }),
      mcpStatus({ mode: "token", connector: "needs-auth", enabled: false }),
    ]) {
      assert.deepEqual(
        slackCardStatus({
          mode: "token",
          mcp,
          mcpLoadFailed: false,
          connection: conn,
        }),
        cardStatusFrom(conn, SLACK_ERROR_COPY),
      );
    }
  }
});

test("token fields show only in token mode", () => {
  assert.equal(showsTokenFields("mcp"), false);
  assert.equal(showsTokenFields("token"), true);
});

test("the consent groups lose the Vault token line only in mcp mode", () => {
  const store = SLACK_CONSENT[1].lines;
  assert.equal(slackConsentLines(store, "mcp").length, store.length - 1);
  assert.ok(!slackConsentLines(store, "mcp").some((l) => l.includes("token")));
  assert.deepEqual(slackConsentLines(store, "token"), [...store]);
});

test("the run line covers running, never run, one item and several items", () => {
  const now = Date.parse("2026-10-08T12:10:00.000Z");
  const lastRunAt = "2026-10-08T12:00:00.000Z";
  assert.equal(
    slackRunLine(mcpStatus({ running: true }), now),
    "Reading Slack",
  );
  assert.equal(slackRunLine(mcpStatus(), now), "Not run yet");
  assert.equal(
    slackRunLine(mcpStatus({ lastRunAt, lastCount: 1 }), now),
    "Last round 10m ago, 1 new item",
  );
  assert.equal(
    slackRunLine(mcpStatus({ lastRunAt, lastCount: 3 }), now),
    "Last round 10m ago, 3 new items",
  );
  assert.equal(
    slackRunLine(mcpStatus({ lastRunAt, lastCount: 0 }), now),
    "Last round 10m ago, 0 new items",
  );
});

test("the run line shows the age alone when the last round has no count", () => {
  const now = Date.parse("2026-10-08T12:10:00.000Z");
  const lastRunAt = "2026-10-08T12:00:00.000Z";
  assert.equal(
    slackRunLine(mcpStatus({ lastRunAt }), now),
    "Last round 10m ago",
  );
  assert.equal(
    slackRunLine(mcpStatus({ lastRunAt, lastCount: undefined }), now),
    "Last round 10m ago",
  );
});
