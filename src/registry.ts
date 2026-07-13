import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isHttpTarget, type GatewayConfig, type ServerTarget } from "./config.js";

const GATEWAY_CLIENT_INFO = { name: "mcp-scout", version: "0.1.0" };

export type NamespacedTool = {
  id: string;
  server: string;
  name: string;
  description: string;
  tool: Tool;
};

export type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

function buildTransport(target: ServerTarget): Transport {
  if (isHttpTarget(target)) {
    return new StreamableHTTPClientTransport(new URL(target.url), {
      requestInit: target.headers ? { headers: target.headers } : undefined,
    });
  }
  return new StdioClientTransport({
    command: target.command,
    args: target.args,
    env: target.env,
    cwd: target.cwd,
  });
}

class Downstream {
  private clientPromise: Promise<Client> | null = null;
  private toolCache: Tool[] | null = null;

  constructor(
    private readonly serverName: string,
    private readonly target: ServerTarget,
  ) {}

  private connect(): Promise<Client> {
    const client = new Client(GATEWAY_CLIENT_INFO, {
      listChanged: {
        tools: {
          onChanged: (error, tools) => {
            if (!error) {
              this.toolCache = tools;
            }
          },
        },
      },
    });
    client.onclose = () => {
      this.clientPromise = null;
      this.toolCache = null;
    };
    client.onerror = () => {
      this.clientPromise = null;
      this.toolCache = null;
    };

    const promise = client.connect(buildTransport(this.target)).then(
      () => client,
      (err) => {
        this.clientPromise = null;
        throw err;
      },
    );
    this.clientPromise = promise;
    return promise;
  }

  private getClient(): Promise<Client> {
    if (!this.clientPromise) {
      return this.connect();
    }
    return this.clientPromise;
  }

  async listTools(forceRefresh = false): Promise<Tool[]> {
    if (this.toolCache && !forceRefresh) {
      return this.toolCache;
    }
    const client = await this.getClient();
    const tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const result: { tools: Tool[]; nextCursor?: string } = await client.listTools(
        cursor ? { cursor } : undefined,
      );
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    this.toolCache = tools;
    return tools;
  }

  async callTool(
    bareName: string,
    args: unknown,
    timeoutMs: number,
  ): Promise<CallToolResult> {
    const client = await this.getClient();
    return client.callTool(
      { name: bareName, arguments: (args ?? {}) as Record<string, unknown> },
      CallToolResultSchema,
      { timeout: timeoutMs, resetTimeoutOnProgress: true },
    );
  }

  async close(): Promise<void> {
    const promise = this.clientPromise;
    this.clientPromise = null;
    this.toolCache = null;
    const client = await promise?.catch(() => null);
    await client?.close();
  }
}

export type AllToolsResult = {
  tools: NamespacedTool[];
  errors: Record<string, string>;
};

export type ResolvedTool = {
  server: string;
  bareName: string;
  tool: Tool;
  callTool: (args: unknown) => Promise<CallToolResult>;
};

export class Registry {
  private readonly downstreams: Map<string, Downstream>;

  readonly timeoutMs: number;

  constructor(config: GatewayConfig, opts: { timeoutMs: number }) {
    this.timeoutMs = opts.timeoutMs;
    this.downstreams = new Map(
      Object.entries(config.mcpServers).map(([name, target]) => [
        name,
        new Downstream(name, target),
      ]),
    );
  }

  listServerNames(): string[] {
    return [...this.downstreams.keys()];
  }

  async getAllTools(): Promise<AllToolsResult> {
    const tools: NamespacedTool[] = [];
    const errors: Record<string, string> = {};

    await Promise.all(
      [...this.downstreams.entries()].map(async ([serverName, downstream]) => {
        try {
          const serverTools = await downstream.listTools();
          for (const tool of serverTools) {
            tools.push({
              id: `${serverName}.${tool.name}`,
              server: serverName,
              name: tool.name,
              description: tool.description ?? "",
              tool,
            });
          }
        } catch (err) {
          errors[serverName] = (err as Error).message;
        }
      }),
    );

    return { tools, errors };
  }

  async resolve(namespacedName: string): Promise<ResolvedTool> {
    const dotIndex = namespacedName.indexOf(".");
    if (dotIndex === -1) {
      throw new Error(
        `Tool name "${namespacedName}" is not namespaced. Expected "server.toolName". ` +
          `Configured servers: ${this.listServerNames().join(", ")}`,
      );
    }

    const serverName = namespacedName.slice(0, dotIndex);
    const bareName = namespacedName.slice(dotIndex + 1);
    const downstream = this.downstreams.get(serverName);
    if (!downstream) {
      throw new Error(
        `Unknown server "${serverName}". Configured servers: ${this.listServerNames().join(", ")}`,
      );
    }

    let tools = await downstream.listTools();
    let tool = tools.find((t) => t.name === bareName);
    if (!tool) {
      tools = await downstream.listTools(true);
      tool = tools.find((t) => t.name === bareName);
    }
    if (!tool) {
      throw new Error(
        `Unknown tool "${namespacedName}" on server "${serverName}".`,
      );
    }

    return {
      server: serverName,
      bareName,
      tool,
      callTool: (args: unknown) =>
        downstream.callTool(bareName, args, this.timeoutMs),
    };
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.downstreams.values()].map((d) => d.close()));
  }
}
