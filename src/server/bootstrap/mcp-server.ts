import { request } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ORCHESTRATOR_TOKEN_HEADER } from "../../shared/orchestrator-limits.js";
import { MCP_TOOLS, splitInput, type McpTool } from "./mcp-tools.js";

interface McpRouteConfig {
  token: string;
  port: number;
}

interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError: boolean;
}

const API_PREFIX = "/api/orchestrator";

const textResult = (text: string, isError: boolean): McpToolResult => ({
  content: [{ type: "text", text }],
  isError,
});

/**
 * Send one tool call to its orchestrator route and wrap the answer as a tool result.
 *
 * @remarks Uses `node:http` with no client timeout because `wait_for_event` can hold a response for
 * 540 seconds before any header, which the `fetch` header timeout of 300 seconds would cut. A
 * cancelled tool call aborts its request, so the server ends a held wait too.
 */
export function callRoute(
  { token, port }: McpRouteConfig,
  tool: McpTool,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<McpToolResult> {
  const { path, rest, sendsRest } = splitInput(tool, input);
  const search = new URLSearchParams();
  if (tool.method === "GET") {
    for (const [key, value] of Object.entries(rest)) {
      if (value === undefined) continue;
      search.set(
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      );
    }
  }
  const query = search.size > 0 ? `?${search.toString()}` : "";
  const payload =
    tool.method !== "GET" && sendsRest ? JSON.stringify(rest) : undefined;
  const headers: Record<string, string> = {
    [ORCHESTRATOR_TOKEN_HEADER]: token,
  };
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = String(Buffer.byteLength(payload));
  }

  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: tool.method,
        path: `${API_PREFIX}${path}${query}`,
        headers,
        signal,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve(
            textResult(
              Buffer.concat(chunks).toString("utf8"),
              (res.statusCode ?? 500) >= 400,
            ),
          ),
        );
        res.on("error", () =>
          resolve(
            textResult(`Connection to 127.0.0.1:${port} was lost.`, true),
          ),
        );
      },
    );
    req.on("error", () =>
      resolve(textResult(`Cannot reach dispatch at 127.0.0.1:${port}.`, true)),
    );
    req.end(payload);
  });
}

/** Serve the tool table over stdio until the client closes the pipe. */
export async function startMcpServer(config: McpRouteConfig): Promise<void> {
  const server = new McpServer({ name: "dispatch", version: "1.0.0" });
  for (const tool of MCP_TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input },
      (input: z.infer<z.ZodObject<z.ZodRawShape>>, extra) =>
        callRoute(config, tool, input, extra.signal),
    );
  }
  await server.connect(new StdioServerTransport());
}
