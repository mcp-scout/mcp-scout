// Real-world benchmark: measures the tool-schema context tax against ACTUAL MCP
// servers taken from a Cursor mcp.json, and proves mcp-scout works end-to-end.
//
//   Direct:      the RAW-INJECTION baseline — every downstream tool's full schema
//                loaded with no deferral at all. This is the real cost in Cursor,
//                LangGraph, the Claude Agent SDK, and most MCP-SDK clients. It is
//                NOT the Claude Code app's cost — that app defers schemas itself
//                by default (native Tool Search) and starts well below this number.
//   Via scout:   what the client pays with only the 4 meta-tools exposed, plus
//                the small per-task cost of a search_tools + describe_tools round.
//
// Usage: tsx bench/real-bench.ts <path-to-mcp.json> [--out results.md] [--redact]
//
// --redact anonymizes anything from the config that shouldn't end up in a
// checked-in report: the config's file path, real server names (replaced with
// generic kind-N labels like "mongodb-1"), skip-reason details, and the actual
// content returned by end-to-end calls (replaced with a byte count).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { countTokens } from "gpt-tokenizer";
import { readFileSync, writeFileSync } from "node:fs";
import { buildGateway } from "../src/gateway.js";
import { Registry } from "../src/registry.js";
import { parseConfig } from "../src/config.js";

const CONNECT_TIMEOUT_MS = 20_000;

type Sized = { bytes: number; tokens: number };
function size(obj: unknown): Sized {
  const json = JSON.stringify(obj);
  return { bytes: Buffer.byteLength(json, "utf-8"), tokens: countTokens(json) };
}
function pct(before: number, after: number): string {
  return `${(100 * (1 - after / before)).toFixed(1)}%`;
}
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  const t = new Promise<T>((_, rej) =>
    setTimeout(() => rej(new Error(`${label}: timeout after ${CONNECT_TIMEOUT_MS}ms`)), CONNECT_TIMEOUT_MS),
  );
  return Promise.race([p, t]);
}

// ---- Redaction helpers (only used when --redact is passed) ----

function serverKind(name: string): string {
  if (/mongodb/i.test(name)) return "mongodb";
  if (/postgres/i.test(name)) return "postgres";
  if (/grafana/i.test(name)) return "grafana";
  return "server";
}

/** Map each real server name to a generic "kind-N" label, in first-seen order. */
function buildLabelMap(namesInOrder: string[]): Map<string, string> {
  const counts = new Map<string, number>();
  const map = new Map<string, string>();
  for (const name of namesInOrder) {
    if (map.has(name)) continue;
    const kind = serverKind(name);
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    map.set(name, `${kind}-${n}`);
  }
  return map;
}

/** Rewrite a "server.tool" id's server prefix to its label. */
function relabelId(id: string, labels: Map<string, string>): string {
  const dot = id.indexOf(".");
  if (dot === -1) return id;
  const server = id.slice(0, dot);
  return (labels.get(server) ?? server) + id.slice(dot);
}

/** Replace every real server name appearing anywhere in free-form text. */
function relabelText(text: string, labels: Map<string, string>): string {
  let out = text;
  for (const [real, label] of [...labels.entries()].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(real).join(label);
  }
  return out;
}

function redactSkipReason(reason: string): string {
  if (/unauthorized|auth/i.test(reason)) return "authentication failed";
  if (/timeout|timed out/i.test(reason)) return "timed out";
  return "connection failed";
}

function buildTransport(target: any) {
  return "url" in target
    ? new StreamableHTTPClientTransport(new URL(target.url), {
        requestInit: target.headers ? { headers: target.headers } : undefined,
      })
    : new StdioClientTransport({ command: target.command, args: target.args, env: target.env });
}

// Connect to each server directly and collect the raw tool list a client would receive.
async function collectDirect(config: { mcpServers: Record<string, any> }) {
  const perServer: Array<{ server: string; tools: Tool[] }> = [];
  const skipped: Array<{ server: string; reason: string }> = [];
  for (const [name, target] of Object.entries(config.mcpServers)) {
    try {
      const client = new Client({ name: "bench-direct", version: "0.0.1" });
      await withTimeout(client.connect(buildTransport(target)), name);
      const { tools } = await withTimeout(client.listTools(), name);
      perServer.push({ server: name, tools });
      await client.close();
    } catch (err) {
      skipped.push({ server: name, reason: (err as Error).message.slice(0, 100) });
    }
  }
  return { perServer, skipped };
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath) throw new Error("usage: tsx bench/real-bench.ts <mcp.json> [--out file] [--redact]");
  const outIdx = process.argv.indexOf("--out");
  const outPath = outIdx !== -1 ? process.argv[outIdx + 1] : undefined;
  const redact = process.argv.includes("--redact");

  const config = parseConfig(JSON.parse(readFileSync(configPath, "utf-8")));
  const serverNames = Object.keys(config.mcpServers);

  console.error(`Connecting to ${serverNames.length} servers from ${configPath}...`);

  // ---- DIRECT: every tool schema, as a client sees it today ----
  const { perServer, skipped } = await collectDirect(config);
  const allTools = perServer.flatMap((s) => s.tools);
  const directSize = size(allTools);

  const labels = buildLabelMap([...perServer.map((s) => s.server), ...skipped.map((s) => s.server)]);
  const displayServer = (name: string) => (redact ? labels.get(name) ?? name : name);
  const displayId = (id: string) => (redact ? relabelId(id, labels) : id);
  const displayText = (text: string) => (redact ? relabelText(text, labels) : text);

  // ---- VIA SCOUT: only the 4 meta-tools are exposed upfront ----
  // Reuse the reachable servers so the gateway indexes the same live tools.
  const reachable = Object.fromEntries(
    perServer.map((s) => [s.server, config.mcpServers[s.server]]),
  );
  const registry = new Registry({ mcpServers: reachable }, { timeoutMs: CONNECT_TIMEOUT_MS });
  const gateway = buildGateway(registry);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await gateway.connect(serverT);
  const client = new Client({ name: "bench-scout", version: "0.0.1" });
  await client.connect(clientT);

  const { tools: metaTools } = await client.listTools();
  const scoutUpfront = size(metaTools);

  // ---- Per-task cost: a real search + describe round for representative queries ----
  const queries = ["list database collections", "query rows from a table", "search dashboards"];
  const taskCosts: Array<{ query: string; searchTokens: number; describeTokens: number; topHit: string }> = [];
  for (const query of queries) {
    const searchRes: any = await client.callTool({ name: "search_tools", arguments: { query, limit: 5 } });
    const searchText = searchRes.content[0].text;
    const parsed = JSON.parse(searchText);
    const topHit = parsed.matches[0]?.name;
    let describeTokens = 0;
    if (topHit) {
      const descRes: any = await client.callTool({ name: "describe_tools", arguments: { names: [topHit] } });
      describeTokens = countTokens(descRes.content[0].text);
    }
    taskCosts.push({ query, searchTokens: countTokens(searchText), describeTokens, topHit: topHit ?? "(none)" });
  }

  // ---- describe_tools: compact (default) vs full JSON Schema, same tools ----
  const available = new Set(
    perServer.flatMap((s) => s.tools.map((t) => `${s.server}.${t.name}`)),
  );
  // Representative tools spanning small and heavy schemas, whichever are present.
  const describeSamples = [
    "grafana.update_dashboard",
    "grafana.search_dashboards",
    "mongodb-dev.find",
    "mongodb-dev.aggregate",
    "postgres-dev.execute_sql",
  ].filter((n) => available.has(n));
  const describeCmp: Array<{ tool: string; fullTokens: number; compactTokens: number }> = [];
  for (const tool of describeSamples) {
    const fullRes: any = await client.callTool({
      name: "describe_tools",
      arguments: { names: [tool], detail: "full" },
    });
    const compactRes: any = await client.callTool({
      name: "describe_tools",
      arguments: { names: [tool] },
    });
    describeCmp.push({
      tool,
      fullTokens: countTokens(fullRes.content[0].text),
      compactTokens: countTokens(compactRes.content[0].text),
    });
  }

  // ---- Self-correction: call a known tool with bad args, capture the hint ----
  let selfCorrect: { tool: string; hint: string } | null = null;
  const argTool = ["mongodb-dev.find", "postgres-dev.execute_sql", "grafana.search_dashboards"].find(
    (n) => available.has(n),
  );
  if (argTool) {
    const badRes: any = await client.callTool({
      name: "call_tool",
      arguments: { name: argTool, args: { __definitely_not_a_real_param: 1 } },
    });
    const joined = (badRes.content as any[]).map((c) => c.text ?? "").join("\n");
    const line = joined.split("\n").find((l: string) => l.includes("Expected arguments:")) ?? "(no hint)";
    selfCorrect = { tool: argTool, hint: line.trim() };
  }

  // ---- Prove a real end-to-end call actually works ----
  // Try genuinely zero-arg, read-only "list" tools until one returns real data.
  const e2eResults: Array<{ tool: string; ok: boolean; preview: string }> = [];
  const zeroArgCandidates = [
    "mongodb-dev.list-databases",
    "mongodb-staging.list-databases",
    "postgres-dev.list_schemas",
    "postgres-stage.list_schemas",
    "grafana.list_datasources",
  ].filter((n) => available.has(n));
  for (const chosen of zeroArgCandidates) {
    try {
      const callRes: any = await withTimeout(
        client.callTool({ name: "call_tool", arguments: { name: chosen, args: {} } }),
        "e2e",
      );
      const preview = (callRes.content?.[0]?.text ?? JSON.stringify(callRes.content)).slice(0, 400);
      e2eResults.push({ tool: chosen, ok: !callRes.isError, preview });
    } catch (err) {
      e2eResults.push({ tool: chosen, ok: false, preview: (err as Error).message.slice(0, 400) });
    }
  }

  await client.close();
  await registry.closeAll();

  // ---- Report ----
  const avgTask = taskCosts.reduce((a, t) => a + t.searchTokens + t.describeTokens, 0) / taskCosts.length;
  const lines: string[] = [];
  const L = (s = "") => lines.push(s);

  L(`# mcp-scout — real-world token benchmark`);
  L();
  L(
    redact
      ? `Source: a local \`mcp.json\`-style config with ${serverNames.length} servers configured (path and server identities redacted).`
      : `Source config: \`${configPath}\``,
  );
  L(`Tokenizer: \`o200k_base\` (gpt-tokenizer), matching GPT-4o / modern context accounting.`);
  L();
  L(`## Servers measured`);
  L();
  L(`| Server | Tools | Status |`);
  L(`|---|--:|---|`);
  for (const s of perServer) L(`| ${displayServer(s.server)} | ${s.tools.length} | connected |`);
  for (const s of skipped)
    L(`| ${displayServer(s.server)} | — | skipped: ${redact ? redactSkipReason(s.reason) : s.reason} |`);
  L(`| **Total (connected)** | **${allTools.length}** | |`);
  L();
  L(`## Upfront context cost (paid on EVERY turn)`);
  L();
  L(
    `**"Direct" = raw injection, no schema deferral** — the real cost in Cursor, LangGraph, the ` +
      `Claude Agent SDK, and most MCP-SDK clients. It is NOT the Claude Code app's cost: that app ` +
      `defers schemas itself by default (native Tool Search) and starts well below this number.`,
  );
  L();
  L(`| | Tools exposed | JSON bytes | Tokens |`);
  L(`|---|--:|--:|--:|`);
  L(`| Direct (raw injection, no native deferral; all servers connected) | ${allTools.length} | ${directSize.bytes.toLocaleString()} | ${directSize.tokens.toLocaleString()} |`);
  L(`| Via mcp-scout | ${metaTools.length} | ${scoutUpfront.bytes.toLocaleString()} | ${scoutUpfront.tokens.toLocaleString()} |`);
  L(`| **Reduction** | | **${pct(directSize.bytes, scoutUpfront.bytes)}** | **${pct(directSize.tokens, scoutUpfront.tokens)}** |`);
  L();
  L(`## Cost of a single tool call: without mcp-scout vs with`);
  L();
  L(
    `Without mcp-scout (raw injection, no native deferral), a client must have every downstream ` +
      `tool's schema loaded before it can call *any* of them — so calling even one tool costs the ` +
      `full ${directSize.tokens.toLocaleString()}-token upfront payload. With mcp-scout, calling one tool costs only ` +
      `the ${scoutUpfront.tokens.toLocaleString()}-token meta-tool upfront cost plus that tool's own \`search_tools\` + ` +
      `\`describe_tools\` round:`,
  );
  L();
  L(`| To call... | Without mcp-scout | With mcp-scout | Reduction |`);
  L(`|---|--:|--:|--:|`);
  for (const t of taskCosts) {
    const withScout = scoutUpfront.tokens + t.searchTokens + t.describeTokens;
    L(
      `| ${t.query} | ${directSize.tokens.toLocaleString()} | ${withScout.toLocaleString()} | ${pct(directSize.tokens, withScout)} |`,
    );
  }
  L();
  L(`## Per-task cost via mcp-scout (search_tools + describe_tools)`);
  L();
  L(`| Query | Top hit | search tokens | describe tokens | task total |`);
  L(`|---|---|--:|--:|--:|`);
  for (const t of taskCosts)
    L(`| ${t.query} | ${displayId(t.topHit)} | ${t.searchTokens} | ${t.describeTokens} | ${t.searchTokens + t.describeTokens} |`);
  L(`| **Average** | | | | **${Math.round(avgTask)}** |`);
  L();
  L(`## describe_tools: compact (default) vs full JSON Schema`);
  L();
  L(`Same tools, described both ways. Compact is the default; \`detail:"full"\` returns raw JSON Schema.`);
  L();
  L(`| Tool | full tokens | compact tokens | reduction |`);
  L(`|---|--:|--:|--:|`);
  let fullSum = 0;
  let compactSum = 0;
  for (const d of describeCmp) {
    fullSum += d.fullTokens;
    compactSum += d.compactTokens;
    L(`| ${displayId(d.tool)} | ${d.fullTokens.toLocaleString()} | ${d.compactTokens.toLocaleString()} | ${pct(d.fullTokens, d.compactTokens)} |`);
  }
  if (describeCmp.length > 0)
    L(`| **Total** | **${fullSum.toLocaleString()}** | **${compactSum.toLocaleString()}** | **${pct(fullSum, compactSum)}** |`);
  L();
  L(`## Round-trip elimination`);
  L();
  L(`- \`search_tools\` now returns a compact call **signature** per hit, so simple tools can be called straight from search — no \`describe_tools\` round.`);
  if (selfCorrect) {
    L(`- \`call_tool\` echoes the expected signature when args are wrong, so the model self-corrects without a describe round. Live example (\`${displayId(selfCorrect.tool)}\` called with a bogus param):`);
    L();
    L("```");
    L(displayText(selfCorrect.hint));
    L("```");
  }
  L();
  L(`## Break-even analysis`);
  L();
  const upfrontSaving = directSize.tokens - scoutUpfront.tokens;
  L(`- Direct pays **${directSize.tokens.toLocaleString()} tokens up front, every turn**.`);
  L(`- mcp-scout pays **${scoutUpfront.tokens.toLocaleString()} tokens up front**, plus ~**${Math.round(avgTask)} tokens** per tool actually used.`);
  L(`- Even if a session uses several tools, scout stays far below the direct baseline: you would need ~**${Math.round(upfrontSaving / avgTask)} tool lookups in a single turn** before scout's per-turn cost caught up with direct.`);
  L();
  L(`## End-to-end correctness`);
  L();
  if (e2eResults.length > 0) {
    L(`Ran real \`call_tool\` requests through the gateway to live downstream servers:`);
    L();
    for (const e of e2eResults) {
      L(`### \`${displayId(e.tool)}\` — ${e.ok ? "✅ success (isError=false)" : "⚠️ returned error"}`);
      L("```");
      L(redact ? `(real data returned — ${e.preview.length} chars, content redacted)` : e.preview);
      L("```");
      L();
    }
  } else {
    L(`No zero-arg list-style tool found for an automatic end-to-end call.`);
  }
  L();

  const report = lines.join("\n");
  console.log(report);
  if (outPath) {
    writeFileSync(outPath, report);
    console.error(`\nWrote ${outPath}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
