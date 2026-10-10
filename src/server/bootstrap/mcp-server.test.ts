import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { run } from "../adapters/exec.js";
import { MCP_TOOLS } from "./mcp-tools.js";

interface Seen {
  method?: string;
  url?: string;
  token?: string | string[];
  contentType?: string;
  body: string;
}

const CLI = "src/server/bootstrap/cli.ts";
const TOKEN = "tok-test-123";
const REFUSALS: Record<string, [number, string]> = {
  "/api/orchestrator/cards/ABC-403": [
    403,
    '{"error":"policy-refused","details":{"reason":"ship rights are none"}}',
  ],
  "/api/orchestrator/cards/ABC-409": [409, '{"error":"session-busy"}'],
};

const childEnv = (extra: Record<string, string>) => {
  const env = { ...process.env } as Record<string, string>;
  delete env.NODE_ENV;
  delete env.DISPATCH_ORCHESTRATOR_TOKEN;
  delete env.DISPATCH_PORT;
  return { ...env, ...extra };
};

describe("dispatch mcp", () => {
  const seen: Seen[] = [];
  let heldClosed = 0;
  let fake: Server;
  let client: Client;
  let transport: StdioClientTransport;

  before(async () => {
    fake = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({
          method: req.method,
          url: req.url,
          token: req.headers["x-orchestrator-token"],
          contentType: req.headers["content-type"],
          body: Buffer.concat(chunks).toString("utf8"),
        });
        if (req.url?.endsWith("/events/wait")) {
          res.on("close", () => heldClosed++);
          return;
        }
        const [status, text] = REFUSALS[req.url ?? ""] ?? [200, '{"ok":true}'];
        res.writeHead(status, { "content-type": "application/json" });
        res.end(text);
      });
    });
    await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", resolve));
    const port = (fake.address() as AddressInfo).port;
    transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", CLI, "mcp"],
      env: childEnv({
        DISPATCH_ORCHESTRATOR_TOKEN: TOKEN,
        DISPATCH_PORT: String(port),
      }),
      stderr: "pipe",
    });
    client = new Client({ name: "mcp-server-test", version: "1.0.0" });
    await client.connect(transport);
  });

  after(async () => {
    await client.close();
    await new Promise<void>((resolve) => fake.close(() => resolve()));
  });

  it("lists the 29 tools", async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((t) => t.name).sort(),
      MCP_TOOLS.map((t) => t.name).sort(),
    );
    assert.equal(tools.length, 29);
  });

  it("sends get_card as a GET with the token header", async () => {
    seen.length = 0;
    const result = await client.callTool({
      name: "get_card",
      arguments: { id: "ABC-12" },
    });
    assert.notEqual(result.isError, true);
    assert.deepEqual(result.content, [{ type: "text", text: '{"ok":true}' }]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.method, "GET");
    assert.equal(seen[0]?.url, "/api/orchestrator/cards/ABC-12");
    assert.equal(seen[0]?.token, TOKEN);
  });

  it("sends send_input as a POST with the JSON body", async () => {
    seen.length = 0;
    await client.callTool({
      name: "send_input",
      arguments: { cardId: "ABC-12", text: "continue" },
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.method, "POST");
    assert.equal(seen[0]?.url, "/api/orchestrator/sessions/ABC-12/input");
    assert.equal(seen[0]?.token, TOKEN);
    assert.equal(seen[0]?.contentType, "application/json");
    assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), { text: "continue" });
  });

  it("sends a query string for a list tool", async () => {
    seen.length = 0;
    await client.callTool({
      name: "list_cards",
      arguments: { column: "todo" },
    });
    assert.equal(seen[0]?.url, "/api/orchestrator/cards?column=todo");
  });

  it("serves a tool with no input", async () => {
    seen.length = 0;
    const result = await client.callTool({ name: "get_policy", arguments: {} });
    assert.notEqual(result.isError, true);
    assert.equal(seen[0]?.url, "/api/orchestrator/policy");
  });

  it("sends the array body of start_ship on the wire as given", async () => {
    seen.length = 0;
    const branches = [
      { name: "unit-1", title: "First change", body: "What: one" },
      { name: "unit-2", title: "Second change", body: "What: two" },
    ];
    const result = await client.callTool({
      name: "start_ship",
      arguments: { cardId: "ABC-12", repository: "/repo/app", branches },
    });
    assert.notEqual(result.isError, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.method, "POST");
    assert.equal(seen[0]?.url, "/api/orchestrator/groups/ABC-12/ship");
    assert.equal(seen[0]?.contentType, "application/json");
    assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), {
      repository: "/repo/app",
      branches,
    });
  });

  it("returns a 403 and a 409 JSON refusal as an error result with the body text", async () => {
    for (const [id, [, text]] of [
      ["ABC-403", REFUSALS["/api/orchestrator/cards/ABC-403"]],
      ["ABC-409", REFUSALS["/api/orchestrator/cards/ABC-409"]],
    ] as const) {
      const result = await client.callTool({
        name: "get_card",
        arguments: { id },
      });
      assert.equal(result.isError, true, id);
      assert.deepEqual(result.content, [{ type: "text", text }], id);
    }
  });

  it("returns an error result that says it cannot reach dispatch when the port is closed", async () => {
    const closed = createServer();
    await new Promise<void>((resolve) =>
      closed.listen(0, "127.0.0.1", resolve),
    );
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    const lonely = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", CLI, "mcp"],
      env: childEnv({
        DISPATCH_ORCHESTRATOR_TOKEN: TOKEN,
        DISPATCH_PORT: String(port),
      }),
      stderr: "pipe",
    });
    const other = new Client({ name: "mcp-closed-port", version: "1.0.0" });
    await other.connect(lonely);
    try {
      const result = await other.callTool({
        name: "get_policy",
        arguments: {},
      });
      assert.equal(result.isError, true);
      assert.deepEqual(result.content, [
        { type: "text", text: `Cannot reach dispatch at 127.0.0.1:${port}.` },
      ]);
    } finally {
      await other.close();
    }
  });

  it("refuses an invalid card id before any HTTP call", async () => {
    seen.length = 0;
    const result = await client.callTool({
      name: "send_input",
      arguments: { cardId: "A".repeat(201), text: "hi" },
    });
    assert.equal(result.isError, true);
    assert.equal(seen.length, 0);
  });

  it("aborts the held request when the tool call is cancelled", async () => {
    const cancel = new AbortController();
    const call = client
      .callTool(
        { name: "wait_for_event", arguments: { since: 0, timeoutSeconds: 55 } },
        undefined,
        { signal: cancel.signal },
      )
      .catch(() => null);
    const deadline = Date.now() + 5000;
    while (!seen.some((s) => s.url?.endsWith("/events/wait"))) {
      assert.ok(Date.now() < deadline, "wait request never arrived");
      await new Promise((r) => setTimeout(r, 20));
    }
    cancel.abort();
    await call;
    while (heldClosed === 0) {
      assert.ok(Date.now() < deadline, "held request was not closed");
      await new Promise((r) => setTimeout(r, 20));
    }
  });

  it("exits 1 when the port is not a plain number", async () => {
    await assert.rejects(
      run(process.execPath, ["--import", "tsx", CLI, "mcp"], {
        env: { DISPATCH_ORCHESTRATOR_TOKEN: TOKEN, DISPATCH_PORT: "0xBAB6" },
      }),
      (err: { code?: number }) => err.code === 1,
    );
  });

  it("exits 1 with one stderr line when the token is missing", async () => {
    await assert.rejects(
      run(process.execPath, ["--import", "tsx", CLI, "mcp"], {
        env: {
          DISPATCH_ORCHESTRATOR_TOKEN: "",
          DISPATCH_PORT: "1",
          NODE_NO_WARNINGS: "1",
        },
      }),
      (err: { code?: number; stdout: string; stderr: string }) => {
        assert.equal(err.code, 1);
        assert.equal(err.stdout, "");
        assert.equal(err.stderr.trim().split("\n").length, 1);
        return true;
      },
    );
  });
});
