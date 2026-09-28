/**
 * Loopback fake of the Sentry API for sandbox runs (dev tooling, never imported by the app).
 *
 * Usage: node scripts/fake-sentry.mjs <port> <state.json>
 *
 * Point a sandbox server at it with DISPATCH_SENTRY_API_URL=http://127.0.0.1:<port>. The state
 * file is re-read on every request, so a QA step edits it to change what Sentry reports. Every
 * request's method, path, query and body (never its headers) is appended to requests.jsonl beside
 * the state file. Shape of state.json:
 *   { auth: boolean, token?: string, rateLimited?: boolean,
 *     orgs: [{ slug, regionUrl?, forbidden?: boolean }],
 *     issues: [{ id, org, project, title, culprit?, level?, count?, userCount?, firstSeen?,
 *                lastSeen?, shortId?, assigned?: boolean, status?: "unresolved" | "resolved",
 *                event?: <latest event JSON returned as is>, eventStatus?: <HTTP status for the
 *                latest event read> }] }
 * A token is valid when auth is true and, if state.token is set, the bearer equals it. A forbidden
 * org answers 403 on its scoped calls. Resolving sets the issue status. It binds 127.0.0.1 only and
 * refuses ports 4700 and 4710.
 */
import {
  appendFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";

const port = Number(process.argv[2] ?? 47956);
const statePath = process.argv[3];
if (!statePath) {
  console.error("usage: node scripts/fake-sentry.mjs <port> <state.json>");
  process.exit(1);
}
if (port === 4700 || port === 4710) {
  console.error("refusing a port reserved for a live Dispatch instance");
  process.exit(1);
}
const requestsPath = join(dirname(statePath), "requests.jsonl");
const origin = `http://127.0.0.1:${port}`;

/** Read the current fake state from disk. */
function readState() {
  return JSON.parse(readFileSync(statePath, "utf8"));
}

/** Write the fake state through a temp file so a concurrent read never sees a partial file. */
function writeState(state) {
  writeFileSync(`${statePath}.fake-tmp`, JSON.stringify(state, null, 2));
  renameSync(`${statePath}.fake-tmp`, statePath);
}

/** An issue in Sentry's list and detail shape. */
function issueBody(issue) {
  return {
    id: String(issue.id),
    title: issue.title,
    culprit: issue.culprit ?? "",
    permalink: `https://${issue.org}.sentry.io/issues/${issue.id}/`,
    shortId: issue.shortId ?? `${issue.project.toUpperCase()}-${issue.id}`,
    level: issue.level ?? "error",
    count: String(issue.count ?? 1),
    userCount: issue.userCount ?? 0,
    firstSeen: issue.firstSeen ?? "2026-09-20T09:00:00Z",
    lastSeen: issue.lastSeen ?? "2026-09-25T09:00:00Z",
    status: issue.status ?? "unresolved",
    project: { slug: issue.project },
  };
}

/** Answer one request from the current state as [status, body, headers]. */
function answer(state, method, url, body, bearer) {
  if (!state.auth || (state.token && bearer !== state.token)) {
    return [401, { detail: "Invalid token" }, {}];
  }
  if (state.rateLimited) {
    return [
      429,
      { detail: "Rate limit exceeded" },
      { "x-sentry-rate-limit-remaining": "0" },
    ];
  }
  const path = url.pathname;
  if (method === "GET" && path === "/api/0/organizations/") {
    return [
      200,
      state.orgs.map((o) => ({
        slug: o.slug,
        name: o.slug,
        links: { regionUrl: o.regionUrl ?? origin },
      })),
      {},
    ];
  }
  const m =
    /^\/api\/0\/organizations\/([^/]+)\/issues\/(?:([^/]+)\/(events\/latest\/)?)?$/.exec(
      path,
    );
  if (!m) return [404, { detail: "Not found" }, {}];
  const [, orgSlug, issueId, latest] = m;
  const org = state.orgs.find((o) => o.slug === orgSlug);
  if (!org) return [404, { detail: "Not found" }, {}];
  if (org.forbidden) {
    return [403, { detail: "You do not have permission" }, {}];
  }
  if (!issueId) {
    const query = url.searchParams.get("query") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? 100);
    const rows = state.issues.filter(
      (i) =>
        i.org === orgSlug &&
        (i.status ?? "unresolved") === "unresolved" &&
        (!query.includes("assigned:me") || i.assigned === true),
    );
    const more = rows.length > limit;
    return [
      200,
      rows.slice(0, limit).map(issueBody),
      {
        link: `<${origin}${path}?cursor=0:0:1>; rel="previous"; results="false", <${origin}${path}?cursor=0:${limit}:0>; rel="next"; results="${more}"`,
      },
    ];
  }
  const issue = state.issues.find(
    (i) => i.org === orgSlug && String(i.id) === issueId,
  );
  if (!issue) return [404, { detail: "Not found" }, {}];
  if (latest) {
    if (method !== "GET") return [405, { detail: "Method not allowed" }, {}];
    if (issue.eventStatus) {
      return [issue.eventStatus, { detail: "Latest event unavailable" }, {}];
    }
    return [200, issue.event ?? { id: "e0", entries: [], tags: [] }, {}];
  }
  if (method === "GET") return [200, issueBody(issue), {}];
  if (method === "PUT") {
    if (body?.status !== "resolved") {
      return [400, { detail: "Unsupported status" }, {}];
    }
    issue.status = "resolved";
    writeState(state);
    return [200, issueBody(issue), {}];
  }
  return [405, { detail: "Method not allowed" }, {}];
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const url = new URL(req.url ?? "/", origin);
    let body = null;
    try {
      body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
        : null;
    } catch {
      body = null;
    }
    appendFileSync(
      requestsPath,
      JSON.stringify({
        at: new Date().toISOString(),
        method: req.method,
        path: url.pathname,
        query: url.search,
        body,
      }) + "\n",
    );
    const auth = req.headers.authorization ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    let status;
    let payload;
    let headers;
    try {
      [status, payload, headers] = answer(
        readState(),
        req.method,
        url,
        body,
        bearer,
      );
    } catch (err) {
      [status, payload, headers] = [
        500,
        { detail: `fake state error: ${err.message}` },
        {},
      ];
    }
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(payload));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake-sentry listening on 127.0.0.1:${port}`);
});
