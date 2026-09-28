/**
 * Loopback fake of the read-only Slack Web API for sandbox runs (dev tooling, never imported by the app).
 *
 * Usage: node scripts/fake-slack.mjs <port> <state.json>
 *
 * Point a sandbox server at it with DISPATCH_SLACK_API_URL=http://127.0.0.1:<port>. The state file
 * is re-read on every request, so a QA step edits it to change what Slack reports. Every request's
 * method name and query parameters (never its headers) are appended to requests.jsonl beside the
 * state file. Shape of state.json:
 *   { team: { name, url }, tokens: { "<token>": { user, userId, botId? } | { error } },
 *     channels: [{ id, name, is_private? }], generatedChannels?: number,
 *     info?: { "<id>": { name } | { error } },
 *     listRestricted?: boolean, rateLimited?: boolean, down?: boolean }
 * Serves auth.test, users.conversations and conversations.info; anything else answers
 * unknown_method. A state file that does not parse answers 500 until it is fixed. It binds
 * 127.0.0.1 only and refuses ports 4700 and 4710.
 */
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";

const port = Number(process.argv[2] ?? 47975);
const statePath = process.argv[3];
if (!statePath) {
  console.error("usage: node scripts/fake-slack.mjs <port> <state.json>");
  process.exit(1);
}
if (port === 4700 || port === 4710) {
  console.error("refusing a port reserved for a live Dispatch instance");
  process.exit(1);
}
const requestsPath = join(dirname(statePath), "requests.jsonl");

/** Read the current fake state from disk. */
function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

/** Every channel the state lists, with the generated ones appended. */
function allChannels(state) {
  const generated = Array.from(
    { length: state.generatedChannels ?? 0 },
    (_, i) => ({
      id: `C0GEN${String(i + 1).padStart(4, "0")}`,
      name: `gen-${String(i + 1).padStart(4, "0")}`,
      is_private: false,
    }),
  );
  return [...(state.channels ?? []), ...generated];
}

/** One page of a list, with Slack's cursor metadata. */
function page(list, params) {
  const limit = Math.max(1, Math.min(Number(params.get("limit") ?? 100), 1000));
  const start = Number(params.get("cursor") || 0);
  const slice = list.slice(start, start + limit);
  const next = start + limit < list.length ? String(start + limit) : "";
  return { slice, next };
}

/** Answer one Slack method for the caller the token names. */
function answer(method, params, caller, state) {
  if (method === "auth.test") {
    return {
      ok: true,
      url: state.team.url,
      team: state.team.name,
      team_id: "T0G6",
      user: caller.user,
      user_id: caller.userId,
      ...(caller.botId ? { bot_id: caller.botId } : {}),
    };
  }
  if (method === "users.conversations") {
    if (state.listRestricted) return { ok: false, error: "missing_scope" };
    const types = (params.get("types") ?? "public_channel").split(",");
    const channels = allChannels(state)
      .filter((c) =>
        c.is_private
          ? types.includes("private_channel")
          : types.includes("public_channel"),
      )
      .map((c) => ({
        id: c.id,
        name: c.name,
        is_channel: !c.is_private,
        is_group: Boolean(c.is_private),
        is_private: Boolean(c.is_private),
      }));
    const { slice, next } = page(channels, params);
    return {
      ok: true,
      channels: slice,
      response_metadata: { next_cursor: next },
    };
  }
  if (method === "conversations.info") {
    const id = params.get("channel") ?? "";
    const entry = state.info?.[id];
    if (!entry) return { ok: false, error: "channel_not_found" };
    if (entry.error) return { ok: false, error: entry.error };
    return { ok: true, channel: { id, name: entry.name } };
  }
  return { ok: false, error: "unknown_method" };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  const method = url.pathname.split("/").filter(Boolean).pop() ?? "";
  appendFileSync(
    requestsPath,
    `${JSON.stringify({ at: new Date().toISOString(), method, params: Object.fromEntries(url.searchParams) })}\n`,
  );
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  let state;
  try {
    state = readState();
  } catch {
    return send(500, { ok: false, error: "fake_state_unreadable" });
  }
  if (state.down) return send(502, { ok: false });
  if (state.rateLimited)
    return send(
      429,
      { ok: false, error: "ratelimited" },
      { "Retry-After": "1" },
    );
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  const caller = state.tokens?.[bearer];
  if (!caller) return send(200, { ok: false, error: "invalid_auth" });
  if (caller.error) return send(200, { ok: false, error: caller.error });
  send(200, answer(method, url.searchParams, caller, state));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake slack on 127.0.0.1:${port}`);
});
