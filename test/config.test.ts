import { describe, expect, it } from "vitest";
import { ConfigError, isHttpTarget, parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("accepts a stdio server target", () => {
    const config = parseConfig({
      mcpServers: {
        github: { command: "npx", args: ["-y", "github-mcp"], env: { TOKEN: "x" } },
      },
    });
    expect(config.mcpServers.github).toMatchObject({ command: "npx" });
    expect(isHttpTarget(config.mcpServers.github)).toBe(false);
  });

  it("accepts an http server target", () => {
    const config = parseConfig({
      mcpServers: {
        remote: { url: "https://example.com/mcp", headers: { Authorization: "Bearer x" } },
      },
    });
    expect(isHttpTarget(config.mcpServers.remote)).toBe(true);
  });

  it("accepts a mix of stdio and http targets", () => {
    const config = parseConfig({
      mcpServers: {
        local: { command: "node", args: ["server.js"] },
        remote: { url: "https://example.com/mcp" },
      },
    });
    expect(Object.keys(config.mcpServers)).toEqual(["local", "remote"]);
  });

  it("tolerates Claude-style extra keys like 'type'", () => {
    const config = parseConfig({
      mcpServers: {
        foo: { type: "stdio", command: "node", args: ["server.js"] },
      },
    });
    expect(config.mcpServers.foo).toMatchObject({ command: "node" });
  });

  it("rejects an entry with neither command nor url", () => {
    expect(() =>
      parseConfig({ mcpServers: { broken: { env: { X: "1" } } } }),
    ).toThrow(ConfigError);
  });

  it("accepts an optional search.strategy block", () => {
    const config = parseConfig({
      mcpServers: { local: { command: "node", args: ["server.js"] } },
      search: { strategy: "bm25" },
    });
    expect(config.search?.strategy).toBe("bm25");
  });

  it("accepts search.options for tuning the strategy's ranking weights", () => {
    const config = parseConfig({
      mcpServers: { local: { command: "node", args: ["server.js"] } },
      search: { strategy: "bm25", options: { nameWeight: 5, substringBonus: 0 } },
    });
    expect(config.search?.options).toEqual({ nameWeight: 5, substringBonus: 0 });
  });

  it("rejects a config missing mcpServers", () => {
    expect(() => parseConfig({})).toThrow(ConfigError);
  });

  it("rejects a non-object config", () => {
    expect(() => parseConfig("not an object")).toThrow(ConfigError);
  });
});
