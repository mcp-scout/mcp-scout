import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGateway } from "../src/gateway.js";
import { Registry } from "../src/registry.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const tsxBin = path.join(projectRoot, "node_modules", ".bin", "tsx");
const dummyServerPath = path.join(projectRoot, "test", "fixtures", "dummy-server.ts");
const flakyServerPath = path.join(projectRoot, "test", "fixtures", "flaky-server.ts");
const pkgVersion = JSON.parse(
  readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
).version as string;

function parseTextResult(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const block = result.content[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("Expected a text content block");
  }
  return JSON.parse(block.text);
}

describe("gateway integration", () => {
  let registry: Registry;
  let client: Client;

  beforeAll(async () => {
    registry = new Registry(
      {
        mcpServers: {
          dummy: { command: tsxBin, args: [dummyServerPath] },
          broken: { command: "definitely-not-a-real-binary-xyz" },
        },
      },
      { timeoutMs: 5000 },
    );

    const gateway = buildGateway(registry);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await gateway.connect(serverTransport);

    client = new Client({ name: "integration-test-client", version: "0.0.1" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await registry.closeAll();
  });

  it("exposes only the meta-tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "call_tool",
      "describe_tools",
      "list_servers",
      "search_tools",
    ]);
  });

  it("advertises the package.json version (no hard-coded drift)", () => {
    expect(client.getServerVersion()?.version).toBe(pkgVersion);
  });

  it("advertises server-level instructions", () => {
    const instructions = client.getInstructions();
    expect(typeof instructions).toBe("string");
    expect(instructions).toMatch(/search_tools/);
    expect(instructions).toMatch(/call_tool/);
  });

  it("list_servers reports the connected and failed downstreams", async () => {
    const result = await client.callTool({ name: "list_servers", arguments: {} });
    const payload = parseTextResult(result as any) as {
      summary: string;
      servers: Array<{ server: string; status: string; toolCount: number; error?: string }>;
    };
    const dummy = payload.servers.find((s) => s.server === "dummy");
    const broken = payload.servers.find((s) => s.server === "broken");
    expect(dummy).toMatchObject({ status: "connected", toolCount: 2 });
    expect(broken?.status).toBe("failed");
    expect(typeof broken?.error).toBe("string");
    expect(payload.summary).toBe("1/2 connected");
  });

  it("does not return search hits from a failed downstream", async () => {
    const result = await client.callTool({
      name: "search_tools",
      arguments: { query: "whatever" },
    });
    const payload = parseTextResult(result as any) as {
      matches: Array<{ name: string }>;
    };
    expect(payload.matches.every((m) => !m.name.startsWith("broken."))).toBe(true);
  });

  it("search_tools finds the dummy server's tools, includes signatures, and warns about the broken one", async () => {
    const result = await client.callTool({
      name: "search_tools",
      arguments: { query: "echo" },
    });
    const payload = parseTextResult(result as any) as {
      matches: Array<{ name: string; signature: string; description: string }>;
      warnings: string[];
    };
    const echo = payload.matches.find((m) => m.name === "dummy.echo");
    expect(echo).toBeDefined();
    expect(echo?.signature).toBe("dummy.echo(text: string!)");
    expect(payload.warnings.some((w) => w.startsWith("broken:"))).toBe(true);
  });

  it("describe_tools returns a compact signature + table by default", async () => {
    const result = await client.callTool({
      name: "describe_tools",
      arguments: { names: ["dummy.echo"] },
    });
    const text = (result as any).content[0].text as string;
    expect(text).toContain("dummy.echo(text: string!)");
    expect(text).toContain("text");
    expect(text).toContain("Echo back the given text");
  });

  it("describe_tools with detail='full' returns the raw JSON input schema", async () => {
    const result = await client.callTool({
      name: "describe_tools",
      arguments: { names: ["dummy.echo"], detail: "full" },
    });
    const payload = parseTextResult(result as any) as Array<{
      name: string;
      inputSchema?: { properties?: Record<string, unknown> };
    }>;
    expect(payload[0].name).toBe("dummy.echo");
    expect(payload[0].inputSchema?.properties).toHaveProperty("text");
  });

  it("call_tool round-trips a real call to the downstream server", async () => {
    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "dummy.echo", args: { text: "hello gateway" } },
    });
    const content = (result as any).content;
    expect(content[0].text).toBe("hello gateway");
    expect((result as any).isError).toBeFalsy();
  });

  it("call_tool handles numeric args against the add tool", async () => {
    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "dummy.add", args: { a: 2, b: 3 } },
    });
    const content = (result as any).content;
    expect(content[0].text).toBe("5");
  });

  it("call_tool echoes the expected signature when args fail validation", async () => {
    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "dummy.add", args: {} },
    });
    expect((result as any).isError).toBe(true);
    const text = ((result as any).content as Array<{ type: string; text?: string }>)
      .map((c) => c.text ?? "")
      .join("\n");
    expect(text).toContain("Expected arguments: dummy.add(a: number!, b: number!)");
  });

  it("call_tool returns isError for an unknown tool name", async () => {
    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "dummy.nonexistent" },
    });
    expect((result as any).isError).toBe(true);
  });

  it("call_tool returns isError for an unnamespaced tool name", async () => {
    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "not-namespaced" },
    });
    expect((result as any).isError).toBe(true);
  });

  it("call_tool returns isError when the downstream server can't spawn", async () => {
    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "broken.whatever" },
    });
    expect((result as any).isError).toBe(true);
  });
});

describe("custom search strategy", () => {
  let registry: Registry;
  let client: Client;

  beforeAll(async () => {
    registry = new Registry(
      { mcpServers: { dummy: { command: tsxBin, args: [dummyServerPath] } } },
      { timeoutMs: 5000 },
    );

    // A trivial strategy that ignores the query and always returns one fixed hit,
    // proving buildGateway actually uses the injected strategy rather than the default.
    const alwaysEcho = (index: Array<{ server: string; name: string; description: string }>) =>
      index
        .filter((t) => t.name === "echo")
        .map((t) => ({
          id: `${t.server}.${t.name}`,
          server: t.server,
          name: t.name,
          description: t.description,
          score: 1,
        }));

    const gateway = buildGateway(registry, { search: alwaysEcho });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await gateway.connect(serverTransport);
    client = new Client({ name: "custom-search-client", version: "0.0.1" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await registry.closeAll();
  });

  it("uses the injected strategy for search_tools", async () => {
    // Query "add" would normally surface dummy.add; the custom strategy only ever
    // returns dummy.echo, so seeing echo (and not add) proves the injection works.
    const result = await client.callTool({ name: "search_tools", arguments: { query: "add" } });
    const payload = parseTextResult(result as any) as { matches: Array<{ name: string }> };
    expect(payload.matches.map((m) => m.name)).toEqual(["dummy.echo"]);
  });
});

describe("downstream reconnect", () => {
  let tmpDir: string;
  let registry: Registry;
  let client: Client;

  beforeAll(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "mcp-scout-flaky-"));
    const markerPath = path.join(tmpDir, "dropped.marker");

    registry = new Registry(
      { mcpServers: { flaky: { command: tsxBin, args: [flakyServerPath, markerPath] } } },
      { timeoutMs: 5000 },
    );

    const gateway = buildGateway(registry);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await gateway.connect(serverTransport);
    client = new Client({ name: "reconnect-test-client", version: "0.0.1" });
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
    await registry.closeAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("transparently retries once when the downstream drops the connection mid-call", async () => {
    // The flaky server kills itself on the first `ping`; the single-retry
    // reconnect should spawn a fresh process and succeed on the second attempt.
    const result = await client.callTool({
      name: "call_tool",
      arguments: { name: "flaky.ping" },
    });
    expect((result as any).isError).toBeFalsy();
    expect((result as any).content[0].text).toBe("pong");
  });
});
