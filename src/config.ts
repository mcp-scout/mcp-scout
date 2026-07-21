import { readFileSync } from "node:fs";
import { z } from "zod";

const stdioTargetSchema = z
  .object({
    command: z.string(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
  })
  .passthrough();

const httpTargetSchema = z
  .object({
    url: z.string().url(),
    headers: z.record(z.string()).optional(),
  })
  .passthrough();

const serverTargetSchema = z.union([stdioTargetSchema, httpTargetSchema]);

const searchConfigSchema = z
  .object({
    strategy: z.string().optional(),
    // Strategy-specific tuning (e.g. bm25's weights); shape depends on the
    // selected strategy, so it's validated by resolveSearchStrategy, not here.
    options: z.record(z.unknown()).optional(),
  })
  .passthrough();

const gatewayConfigSchema = z
  .object({
    mcpServers: z.record(serverTargetSchema),
    search: searchConfigSchema.optional(),
  })
  .passthrough();

export type StdioTarget = z.infer<typeof stdioTargetSchema>;
export type HttpTarget = z.infer<typeof httpTargetSchema>;
export type ServerTarget = StdioTarget | HttpTarget;
export type GatewayConfig = {
  mcpServers: Record<string, ServerTarget>;
  search?: { strategy?: string; options?: Record<string, unknown> };
};

export function isHttpTarget(target: ServerTarget): target is HttpTarget {
  return "url" in target;
}

export class ConfigError extends Error {}

export function parseConfig(raw: unknown): GatewayConfig {
  const result = gatewayConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`Invalid gateway config: ${issues}`);
  }

  return result.data;
}

export function loadConfig(path: string): GatewayConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    throw new ConfigError(
      `Could not read config file "${path}": ${(err as Error).message}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(
      `Config file "${path}" is not valid JSON: ${(err as Error).message}`,
    );
  }

  return parseConfig(raw);
}
