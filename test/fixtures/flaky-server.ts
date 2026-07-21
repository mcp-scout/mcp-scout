#!/usr/bin/env node
// A downstream that drops its connection on the first `ping` call, then works.
// "First call" is coordinated across process restarts via a marker file passed
// as argv[2]: the first spawned process finds no marker, writes it, and exits
// mid-call (closing the pipe → the client sees a dropped connection); the
// reconnect spawns a fresh process that finds the marker and responds normally.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, writeFileSync } from "node:fs";

const markerPath = process.argv[2];
const shouldDrop = Boolean(markerPath) && !existsSync(markerPath);

const server = new McpServer({ name: "flaky", version: "0.0.1" });

server.registerTool(
  "ping",
  { description: "Returns pong (drops the connection on the very first call)", inputSchema: {} },
  async () => {
    if (shouldDrop) {
      writeFileSync(markerPath, "dropped");
      // Die before responding: the stdio pipe closes and the pending request
      // rejects with a dropped-connection error on the client side.
      process.exit(1);
    }
    return { content: [{ type: "text", text: "pong" }] };
  },
);

await server.connect(new StdioServerTransport());
