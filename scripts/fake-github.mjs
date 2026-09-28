/**
 * Loopback fake of the GitHub REST API for sandbox runs (dev tooling, never imported by the app).
 *
 * Usage: node scripts/fake-github.mjs <port> <state.json>
 *
 * Point a sandbox server at it with DISPATCH_GITHUB_API_URL=http://127.0.0.1:<port>. The state
 * file is re-read on every request, so a QA step edits it to change what GitHub reports. Every
 * request's method, path and body (never its headers) is appended to requests.jsonl beside the
 * state file. Shape of state.json:
 *   { auth: boolean, token?: string, login: string, ssoOrgs?: string[], rateLimited?: boolean,
 *     totals?: { review?: number, mention?: number, assigned?: number },
 *     prs: [{ owner, repo, number, title, body?, author, draft?, state?: "open" | "closed",
 *             merged?: boolean, updatedAt?, base?, head?, headSha?, additions?, deletions?,
 *             categories: ("review" | "mention" | "assigned")[],
 *             files?: [{ filename, status?, additions?, deletions?, patch? }],
 *             checks?: [{ name, status?, conclusion?, url? }],
 *             statuses?: [{ context, state, url? }], mergeable?: boolean }] }
 * A token is valid when auth is true and, if state.token is set, the bearer equals it. Reviews and
 * merges are recorded; a merge sets the PR merged and closed. It binds 127.0.0.1 only and refuses
 * ports 4700 and 4710.
 */
import {
  appendFileSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";

const port = Number(process.argv[2] ?? 47955);
const statePath = process.argv[3];
if (!statePath) {
  console.error("usage: node scripts/fake-github.mjs <port> <state.json>");
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

/** Write the fake state through a temp file so a concurrent read never sees a partial file. */
function writeState(state) {
  writeFileSync(`${statePath}.fake-tmp`, JSON.stringify(state, null, 2));
  renameSync(`${statePath}.fake-tmp`, statePath);
}

/** The search category a query string names, or null. */
function categoryOf(q) {
  if (q.includes("review-requested:@me")) return "review";
  if (q.includes("mentions:@me")) return "mention";
  if (q.includes("assignee:@me")) return "assigned";
  return null;
}

/** A PR as a search result item. */
function searchItem(pr) {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? "",
    html_url: `https://github.com/${pr.owner}/${pr.repo}/pull/${pr.number}`,
    repository_url: `https://api.github.com/repos/${pr.owner}/${pr.repo}`,
    user: { login: pr.author },
    draft: pr.draft === true,
    updated_at: pr.updatedAt ?? "2026-09-25T09:00:00Z",
    pull_request: {},
  };
}

/** Find the PR a REST path names. */
function findPr(state, owner, repo, number) {
  return state.prs.find(
    (p) => p.owner === owner && p.repo === repo && p.number === Number(number),
  );
}

/** Answer one request from the current state as [status, body, headers]. */
function answer(state, method, url, body, bearer) {
  if (!state.auth || (state.token && bearer !== state.token)) {
    return [401, { message: "Bad credentials" }, {}];
  }
  if (state.rateLimited) {
    return [
      403,
      { message: "API rate limit exceeded" },
      { "x-ratelimit-remaining": "0" },
    ];
  }
  const path = url.pathname;
  if (method === "GET" && path === "/user") {
    return [200, { login: state.login }, {}];
  }
  if (method === "GET" && path === "/search/issues") {
    const q = url.searchParams.get("q") ?? "";
    const cat = categoryOf(q);
    const open = state.prs.filter(
      (p) => (p.state ?? "open") === "open" && p.categories.includes(cat),
    );
    const sso = state.ssoOrgs?.length
      ? {
          "x-github-sso": `partial-results; organizations=${state.ssoOrgs.join(",")}`,
        }
      : {};
    return [
      200,
      {
        total_count: state.totals?.[cat] ?? open.length,
        incomplete_results: false,
        items: open.slice(0, 100).map(searchItem),
      },
      sso,
    ];
  }
  const m = /^\/repos\/([^/]+)\/([^/]+)\/(pulls|commits)\/([^/]+)(\/.*)?$/.exec(
    path,
  );
  if (!m) return [404, { message: "Not Found" }, {}];
  const [, owner, repo, kind, id, rest = ""] = m;
  if (state.ssoOrgs?.includes(owner)) {
    return [
      403,
      { message: "Resource protected by organization SAML enforcement." },
      {
        "x-github-sso": `required; url=https://github.com/orgs/${owner}/sso?authorization_request=fake`,
      },
    ];
  }
  if (kind === "commits") {
    const pr = state.prs.find(
      (p) =>
        p.owner === owner &&
        p.repo === repo &&
        (p.headSha ?? `sha-${p.number}`) === id,
    );
    if (!pr) return [404, { message: "Not Found" }, {}];
    if (rest === "/check-runs") {
      return [
        200,
        {
          total_count: (pr.checks ?? []).length,
          check_runs: (pr.checks ?? []).map((c) => ({
            name: c.name,
            status: c.status ?? "completed",
            conclusion: c.conclusion ?? "success",
            html_url:
              c.url ?? `https://github.com/${owner}/${repo}/runs/${c.name}`,
          })),
        },
        {},
      ];
    }
    if (rest === "/status") {
      return [
        200,
        {
          state: "success",
          statuses: (pr.statuses ?? []).map((s) => ({
            context: s.context,
            state: s.state,
            target_url: s.url ?? null,
          })),
        },
        {},
      ];
    }
    return [404, { message: "Not Found" }, {}];
  }
  const pr = findPr(state, owner, repo, id);
  if (!pr) return [404, { message: "Not Found" }, {}];
  if (method === "GET" && rest === "") {
    return [
      200,
      {
        number: pr.number,
        title: pr.title,
        body: pr.body ?? null,
        html_url: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
        user: { login: pr.author },
        state: pr.state ?? "open",
        merged_at: pr.merged ? "2026-09-25T10:00:00Z" : null,
        draft: pr.draft === true,
        base: { ref: pr.base ?? "main" },
        head: {
          ref: pr.head ?? `feature-${pr.number}`,
          sha: pr.headSha ?? `sha-${pr.number}`,
        },
        additions: pr.additions ?? 0,
        deletions: pr.deletions ?? 0,
        changed_files: pr.changedFiles ?? (pr.files ?? []).length,
      },
      {},
    ];
  }
  if (method === "GET" && rest === "/files") {
    return [
      200,
      (pr.files ?? []).map((f) => ({
        filename: f.filename,
        status: f.status ?? "modified",
        additions: f.additions ?? 0,
        deletions: f.deletions ?? 0,
        ...(f.patch !== undefined ? { patch: f.patch } : {}),
      })),
      {},
    ];
  }
  if (method === "POST" && rest === "/reviews") {
    if (pr.author === state.login && body?.event === "APPROVE") {
      return [422, { message: "Can not approve your own pull request" }, {}];
    }
    return [200, { id: Date.now(), state: body?.event ?? "COMMENTED" }, {}];
  }
  if (method === "PUT" && rest === "/merge") {
    if (pr.mergeable === false) {
      return [405, { message: "Pull Request is not mergeable" }, {}];
    }
    if (body?.sha && body.sha !== (pr.headSha ?? `sha-${pr.number}`)) {
      return [
        409,
        {
          message: "Head branch was modified. Review and try the merge again.",
        },
        {},
      ];
    }
    pr.merged = true;
    pr.state = "closed";
    writeState(state);
    return [
      200,
      { merged: true, message: "Pull Request successfully merged" },
      {},
    ];
  }
  return [404, { message: "Not Found" }, {}];
}

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
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
        { message: `fake state error: ${err.message}` },
        {},
      ];
    }
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(JSON.stringify(payload));
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake-github listening on 127.0.0.1:${port}`);
});
