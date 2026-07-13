#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "dummy", version: "0.0.1" });

server.registerTool(
  "echo",
  {
    description: "Echo back the given text",
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: "text", text }] }),
);

server.registerTool(
  "add",
  {
    description: "Add two numbers together",
    inputSchema: { a: z.number(), b: z.number() },
  },
  async ({ a, b }) => ({ content: [{ type: "text", text: String(a + b) }] }),
);

await server.connect(new StdioServerTransport());
