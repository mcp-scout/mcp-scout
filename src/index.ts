#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, loadConfig } from "./config.js";
import { buildGateway } from "./gateway.js";
import { Registry } from "./registry.js";
import { resolveSearchStrategy } from "./search.js";

const DEFAULT_CONFIG_PATH = "./mcp-scout.json";
const DEFAULT_TIMEOUT_MS = 60_000;

function parseArgs(argv: string[]): {
  configPath: string;
  timeoutMs: number;
  searchStrategy?: string;
} {
  let configPath = DEFAULT_CONFIG_PATH;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let searchStrategy: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--config") {
      configPath = argv[++i];
    } else if (arg === "--timeout") {
      timeoutMs = Number(argv[++i]);
    } else if (arg === "--search") {
      searchStrategy = argv[++i];
    } else {
      positionals.push(arg);
    }
  }

  if (positionals.length > 0) {
    configPath = positionals[0];
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(`Invalid --timeout value; using default of ${DEFAULT_TIMEOUT_MS}ms`);
    timeoutMs = DEFAULT_TIMEOUT_MS;
  }

  return { configPath, timeoutMs, searchStrategy };
}

async function main(): Promise<void> {
  const { configPath, timeoutMs, searchStrategy } = parseArgs(process.argv.slice(2));

  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  // CLI flag overrides the config's search.strategy; both fall back to the default.
  let search;
  try {
    search = resolveSearchStrategy(searchStrategy ?? config.search?.strategy, config.search?.options);
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const registry = new Registry(config, { timeoutMs });
  const server = buildGateway(registry, { search });

  const shutdown = async () => {
    await registry.closeAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const transport = new StdioServerTransport();
  transport.onclose = () => {
    registry.closeAll().finally(() => process.exit(0));
  };

  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error starting mcp-scout:", err);
  process.exit(1);
});
