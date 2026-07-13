import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { countTokens } from "gpt-tokenizer";
import { buildGateway } from "../src/gateway.js";
import { Registry } from "../src/registry.js";
import { compactSchema, signature, type JsonSchema } from "../src/schema-render.js";
import { searchTools, type IndexedTool } from "../src/search.js";
import { FIXTURE_SERVERS, toolListFor } from "./fixtures.js";

type FixtureTool = { server: string; name: string; description: string; inputSchema: JsonSchema };

function allFixtureTools(): FixtureTool[] {
  return FIXTURE_SERVERS.flatMap((fixture) =>
    toolListFor(fixture).map((t) => ({ ...t, server: fixture.name, inputSchema: t.inputSchema as JsonSchema })),
  );
}

async function measureDirect(): Promise<{ bytes: number; tokens: number; toolCount: number }> {
  const directTools = FIXTURE_SERVERS.flatMap((fixture) => toolListFor(fixture));
  const json = JSON.stringify(directTools);
  return {
    bytes: Buffer.byteLength(json, "utf-8"),
    tokens: countTokens(json),
    toolCount: directTools.length,
  };
}

async function measureViaGateway(): Promise<{ bytes: number; tokens: number; toolCount: number }> {
  const registry = new Registry({ mcpServers: {} }, { timeoutMs: 5000 });
  const gateway = buildGateway(registry);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await gateway.connect(serverTransport);

  const client = new Client({ name: "bench-client", version: "0.0.1" });
  await client.connect(clientTransport);

  const { tools } = await client.listTools();
  const json = JSON.stringify(tools);

  await client.close();
  await registry.closeAll();

  return {
    bytes: Buffer.byteLength(json, "utf-8"),
    tokens: countTokens(json),
    toolCount: tools.length,
  };
}

function pctReduction(before: number, after: number): string {
  return `${(100 * (1 - after / before)).toFixed(1)}%`;
}

// describe_tools: full JSON Schema vs compact signature+table, over every fixture tool.
// Pure data — no live server needed, since the fixture's inputSchema is already
// the same shape a real MCP server would return.
function measureDescribeCompaction(tools: FixtureTool[]): {
  fullTokens: number;
  compactTokens: number;
} {
  let fullTokens = 0;
  let compactTokens = 0;
  for (const t of tools) {
    const id = `${t.server}.${t.name}`;
    fullTokens += countTokens(JSON.stringify({ name: id, description: t.description, inputSchema: t.inputSchema }));
    compactTokens += countTokens(compactSchema(id, t.description, t.inputSchema));
  }
  return { fullTokens, compactTokens };
}

// Per-task cost via mcp-scout: search_tools (with inlined signature) + describe_tools
// (compact) for a representative query per fixture server.
function measurePerTaskCost(tools: FixtureTool[]): Array<{
  query: string;
  topHit: string;
  searchTokens: number;
  describeTokens: number;
}> {
  const index: IndexedTool[] = tools.map((t) => ({ server: t.server, name: t.name, description: t.description }));
  const byId = new Map(tools.map((t) => [`${t.server}.${t.name}`, t]));

  const queries = [
    "create an issue",
    "post a message to a channel",
    "read a file",
    "search pages",
    "query database rows",
  ];

  return queries.map((query) => {
    const matches = searchTools(index, query, 5);
    const searchPayload = matches.map((m) => ({
      name: m.id,
      signature: signature(m.id, byId.get(m.id)?.inputSchema),
      description: m.description,
    }));
    const searchTokens = countTokens(JSON.stringify({ matches: searchPayload, warnings: [] }, null, 2));

    const top = matches[0];
    const topTool = top ? byId.get(top.id) : undefined;
    const describeTokens = topTool ? countTokens(compactSchema(top.id, topTool.description, topTool.inputSchema)) : 0;

    return { query, topHit: top?.id ?? "(none)", searchTokens, describeTokens };
  });
}

async function main(): Promise<void> {
  const direct = await measureDirect();
  const viaGateway = await measureViaGateway();

  console.log(`Fixture: ${FIXTURE_SERVERS.length} servers, ${direct.toolCount} tools total\n`);
  console.log("## Upfront context cost\n");
  console.log("| | Tools exposed | JSON bytes | Tokens (o200k_base) |");
  console.log("|---|---|---|---|");
  console.log(
    `| Direct (${FIXTURE_SERVERS.length} servers connected individually) | ${direct.toolCount} | ${direct.bytes.toLocaleString()} | ${direct.tokens.toLocaleString()} |`,
  );
  console.log(
    `| Via mcp-scout | ${viaGateway.toolCount} | ${viaGateway.bytes.toLocaleString()} | ${viaGateway.tokens.toLocaleString()} |`,
  );
  console.log(
    `| **Reduction** | — | **${pctReduction(direct.bytes, viaGateway.bytes)}** | **${pctReduction(direct.tokens, viaGateway.tokens)}** |`,
  );

  const tools = allFixtureTools();

  const { fullTokens, compactTokens } = measureDescribeCompaction(tools);
  console.log("\n## describe_tools: full JSON Schema vs compact (all 85 fixture tools)\n");
  console.log("| | Tokens (o200k_base) |");
  console.log("|---|---|");
  console.log(`| Full JSON Schema | ${fullTokens.toLocaleString()} |`);
  console.log(`| Compact | ${compactTokens.toLocaleString()} |`);
  console.log(`| **Reduction** | **${pctReduction(fullTokens, compactTokens)}** |`);

  const taskCosts = measurePerTaskCost(tools);
  const avgTask = taskCosts.reduce((a, t) => a + t.searchTokens + t.describeTokens, 0) / taskCosts.length;
  console.log("\n## Per-task cost via mcp-scout (search_tools + describe_tools)\n");
  console.log("| Query | Top hit | search tokens | describe tokens | task total |");
  console.log("|---|---|---|---|---|");
  for (const t of taskCosts) {
    console.log(
      `| ${t.query} | ${t.topHit} | ${t.searchTokens} | ${t.describeTokens} | ${t.searchTokens + t.describeTokens} |`,
    );
  }
  console.log(`| **Average** | | | | **${Math.round(avgTask)}** |`);

  console.log("\n## Cost of a single tool call: without mcp-scout vs with\n");
  console.log(
    `Without mcp-scout, a client must have every downstream tool's schema loaded before it can call ` +
      `*any* of them — so calling even one tool costs the full ${direct.tokens.toLocaleString()}-token upfront ` +
      `payload. With mcp-scout, calling one tool costs only the ${viaGateway.tokens.toLocaleString()}-token meta-tool ` +
      `upfront cost plus that tool's own \`search_tools\` + \`describe_tools\` round:\n`,
  );
  console.log("| To call... | Without mcp-scout | With mcp-scout | Reduction |");
  console.log("|---|---|---|---|");
  for (const t of taskCosts) {
    const withScout = viaGateway.tokens + t.searchTokens + t.describeTokens;
    console.log(
      `| ${t.query} | ${direct.tokens.toLocaleString()} | ${withScout.toLocaleString()} | ${pctReduction(direct.tokens, withScout)} |`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
