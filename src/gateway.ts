import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Registry } from "./registry.js";
import { searchTools, type IndexedTool, type SearchStrategy } from "./search.js";
import { compactSchema, signature, type JsonSchema } from "./schema-render.js";
import { VERSION } from "./version.js";

const GATEWAY_NAME = "mcp-scout";
const GATEWAY_VERSION = VERSION;

const GATEWAY_INSTRUCTIONS =
  "mcp-scout proxies all your downstream MCP servers behind 4 meta-tools instead of " +
  "exposing every tool's schema upfront. Workflow: call search_tools to find a tool by " +
  "keyword (returns namespaced names + compact signatures), describe_tools for full " +
  "parameter details, then call_tool to run it by its 'server.tool' name. Call " +
  "list_servers to see which downstream servers are connected before relying on them.";

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], isError };
}

// Downstream servers signal bad arguments inconsistently: some throw an MCP
// protocol error (-32602), others return an isError result whose text describes
// the validation failure. This matches the common wording of both so we only
// attach the expected signature when it's actually an argument problem.
function looksLikeArgError(text: string): boolean {
  return /invalid|required|expected|argument|schema|validation|missing|must be|type/i.test(text);
}

async function buildIndex(registry: Registry): Promise<{
  index: IndexedTool[];
  byId: Map<string, Tool>;
  warnings: string[];
}> {
  const { tools, errors } = await registry.getAllTools();
  const index = tools.map((t) => ({
    server: t.server,
    name: t.name,
    description: t.description,
  }));
  const byId = new Map(tools.map((t) => [t.id, t.tool]));
  const warnings = Object.entries(errors).map(
    ([server, message]) => `${server}: ${message}`,
  );
  return { index, byId, warnings };
}

async function suggestSimilar(
  registry: Registry,
  search: SearchStrategy,
  query: string,
): Promise<string[]> {
  const { index } = await buildIndex(registry);
  return (await search(index, query, 3)).map((match) => match.id);
}

export function buildGateway(
  registry: Registry,
  opts: { search?: SearchStrategy } = {},
): McpServer {
  const search = opts.search ?? searchTools;
  const server = new McpServer(
    { name: GATEWAY_NAME, version: GATEWAY_VERSION },
    { instructions: GATEWAY_INSTRUCTIONS },
  );

  server.registerTool(
    "search_tools",
    {
      description:
        "Search for tools across all connected downstream MCP servers by keyword. " +
        "Returns matching tool names (namespaced as 'server.tool'), a compact call " +
        "signature, and a short description. For simple tools the signature is enough " +
        "to call_tool directly; call describe_tools only when you need full parameter docs.",
      inputSchema: {
        query: z.string().describe("Keywords describing the tool you need, e.g. 'create jira issue'"),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ query, limit }) => {
      const { index, byId, warnings } = await buildIndex(registry);
      const matches = await search(index, query, limit ?? 10);
      return textResult(
        JSON.stringify(
          {
            matches: matches.map((m) => ({
              name: m.id,
              signature: signature(m.id, byId.get(m.id)?.inputSchema as JsonSchema | undefined),
              description: m.description,
            })),
            warnings,
          },
          null,
          2,
        ),
      );
    },
  );

  server.registerTool(
    "describe_tools",
    {
      description:
        "Get parameter details for one or more tools by their namespaced name " +
        "(as returned by search_tools). Defaults to a compact signature + parameter " +
        "table; pass detail='full' for the raw JSON input schema.",
      inputSchema: {
        names: z.array(z.string()).min(1).max(20),
        detail: z.enum(["compact", "full"]).optional().describe("Default 'compact'"),
      },
    },
    async ({ names, detail }) => {
      const resolutions = await Promise.all(
        names.map(async (name) => {
          try {
            const resolved = await registry.resolve(name);
            return { name, tool: resolved.tool };
          } catch (err) {
            return { name, error: (err as Error).message };
          }
        }),
      );

      if (detail === "full") {
        const results = resolutions.map((r) =>
          "error" in r
            ? { name: r.name, error: r.error }
            : { name: r.name, description: r.tool.description ?? "", inputSchema: r.tool.inputSchema },
        );
        return textResult(JSON.stringify(results, null, 2));
      }

      const blocks = resolutions.map((r) =>
        "error" in r
          ? `${r.name}: ERROR ${r.error}`
          : compactSchema(r.name, r.tool.description, r.tool.inputSchema as JsonSchema),
      );
      return textResult(blocks.join("\n\n"));
    },
  );

  server.registerTool(
    "call_tool",
    {
      description:
        "Call a downstream tool by its namespaced name (as returned by search_tools / describe_tools).",
      inputSchema: {
        name: z.string(),
        args: z.record(z.unknown()).optional(),
      },
    },
    async ({ name, args }) => {
      // Resolve first so we can tell "unknown tool" (→ suggestions) apart from
      // "known tool, bad args" (→ echo the expected signature so the model can
      // self-correct without a separate describe_tools round).
      let resolved;
      try {
        resolved = await registry.resolve(name);
      } catch (err) {
        const message = (err as Error).message;
        const suggestions = await suggestSimilar(registry, search, name).catch(() => []);
        const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
        return textResult(`${message}${hint}`, true);
      }

      try {
        // resolved.callTool() always passes CallToolResultSchema (not the
        // compatibility schema), so the result is always this shape at runtime.
        const result = (await resolved.callTool(args ?? {})) as CallToolResult;

        const content =
          result.content.length > 0
            ? result.content
            : [
                {
                  type: "text" as const,
                  text: JSON.stringify(result.structuredContent ?? {}),
                },
              ];

        // If the downstream reported an error that reads like an argument
        // problem, append the expected signature so the model can fix the call
        // without a separate describe_tools round.
        const errorText = content
          .map((c) => (c.type === "text" ? c.text : ""))
          .join(" ");
        if (result.isError && looksLikeArgError(errorText)) {
          const sig = signature(name, resolved.tool.inputSchema as JsonSchema);
          return {
            content: [...content, { type: "text" as const, text: `\nExpected arguments: ${sig}` }],
            isError: true,
          };
        }
        return { content, isError: result.isError };
      } catch (err) {
        if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
          return textResult(
            `Timed out calling "${name}" after ${registry.timeoutMs}ms. ` +
              `Increase it with --timeout <ms>.`,
            true,
          );
        }

        const message = (err as Error).message;
        if (looksLikeArgError(message)) {
          const sig = signature(name, resolved.tool.inputSchema as JsonSchema);
          return textResult(`${message}\n\nExpected arguments: ${sig}`, true);
        }
        return textResult(message, true);
      }
    },
  );

  server.registerTool(
    "list_servers",
    {
      description:
        "List the configured downstream MCP servers and their health: which are " +
        "connected (with tool counts) and which failed to connect (with the reason). " +
        "Use this to avoid calling tools on a server that is currently down.",
      inputSchema: {},
    },
    async () => {
      const servers = await registry.listServers();
      const connected = servers.filter((s) => s.status === "connected").length;
      return textResult(
        JSON.stringify(
          { summary: `${connected}/${servers.length} connected`, servers },
          null,
          2,
        ),
      );
    },
  );

  return server;
}
