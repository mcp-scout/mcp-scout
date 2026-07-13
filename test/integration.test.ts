import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildGateway } from "../src/gateway.js";
import { Registry } from "../src/registry.js";

const projectRoot = path.resolve(import.meta.dirname, "..");
const tsxBin = path.join(projectRoot, "node_modules", ".bin", "tsx");
const dummyServerPath = path.join(projectRoot, "test", "fixtures", "dummy-server.ts");

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

  it("exposes only the 3 meta-tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "call_tool",
      "describe_tools",
      "search_tools",
    ]);
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
