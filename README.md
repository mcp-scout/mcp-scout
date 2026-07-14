# mcp-scout

[![CI](https://github.com/mcp-scout/mcp-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/mcp-scout/mcp-scout/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40raghudr15%2Fmcp-scout.svg)](https://www.npmjs.com/package/@raghudr15/mcp-scout)
[![license](https://img.shields.io/npm/l/%40raghudr15%2Fmcp-scout.svg)](LICENSE)

An [MCP](https://modelcontextprotocol.io) server that sits between your client (Claude Desktop, Cursor, etc.) and all your *other* MCP servers.

Open source, MIT licensed — contributions welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## The problem

Connect an MCP client to a handful of servers and every tool's full JSON schema gets loaded into the model's context before it does anything — in this project's own benchmark, wiring up 5 real MCP servers (112 tools) cost 49,975 tokens of upfront schema, before a single tool was ever called (see [Benchmark](#benchmark)).

## What this does

Instead of connecting your client directly to N servers, point it at mcp-scout, and it connects to all of them for you. Your client sees exactly **3 tools** instead of N servers' worth:

- **`search_tools(query, limit?)`** — keyword search over every downstream tool's name and description. Each match returns `server.toolName`, a compact call **signature** (`server.tool(a: string!, b?: number)`), and a short description — not the full schema. For simple tools the signature is enough to call directly.
- **`describe_tools(names[], detail?)`** — parameter details for specific tools. Defaults to a compact signature + parameter table (a fraction of the tokens of raw JSON Schema); pass `detail:"full"` for the raw JSON Schema. Complex params (enums, nested objects) always keep their full sub-schema, so nothing is lost.
- **`call_tool(name, args)`** — call a downstream tool by its namespaced name (`server.toolName`). If the args fail validation, the error echoes the expected signature so the model can self-correct without another round trip.

Downstream servers are connected lazily (only once actually needed) and their tool lists are cached and kept fresh via `notifications/tools/list_changed`. A downstream server that fails to start or crashes shows up as a warning, not a crash.

## How this compares

Several projects aggregate multiple MCP servers behind one endpoint. Most default to solving *connection* sprawl (one client config instead of N) while still handing the model every downstream schema up front — they don't default to solving the *context* tax. This project defaults to the opposite: search-first, schemas on demand, with nothing else.

| | mcp-scout | [MetaMCP](https://github.com/metatool-ai/metamcp) | [1mcp/agent](https://github.com/1mcp-app/agent) | [mcgravity](https://github.com/tigranbs/mcgravity) |
|---|---|---|---|---|
| Client sees, by default | 3 meta-tools, always | All downstream tools (flat, namespaced) | All downstream tools (flat, via `serve`) | All downstream tools (per backend) |
| Schema-on-demand option | Yes — the only mode | No | Yes — separate CLI mode (`instructions`/`inspect`/`run`), opt-in, not the default `serve` behavior | No |
| Primary goal | Cut context-window tax | Aggregation + middleware + RBAC | Aggregation + OAuth 2.1 | Load balancing / horizontal scaling |
| Tool discovery | `search_tools` keyword search | Browse full list / namespace UI | Browse full list (default) or CLI inspect flow | Browse full list per backend |
| Runtime | Single Node process, `npx` | Docker (Next.js app + Postgres) | Node process | Go binary |
| Setup | Point at a `.mcp.json`-shaped file, run | Web UI, DB-backed config | Config file / env | Nginx-style config |
| Extra features | — (intentionally minimal) | Namespaces, RBAC, middleware, web UI | OAuth 2.1, per-client/session templating | Load balancing, failover |

1mcp/agent is the closest in spirit — its CLI mode does progressive tool discovery too — but it's an alternate mode layered on top of a primarily flat aggregator, whereas this project has no flat mode at all.

If you already need RBAC, a web UI, or load balancing, those tools cover more ground. If your actual problem is "my agent's context is 70% tool schemas before it does anything," this is the narrower tool built specifically for that.

## Benchmark

Measured, not estimated: [`bench/run.ts`](bench/run.ts) builds a synthetic-but-realistic fixture set — 6 servers modeled at the scale of GitHub, Slack, Jira, Drive, filesystem, and Notion — and captures the *actual* `tools/list` JSON-RPC response both ways: once as the raw combined tool list those 6 servers would hand a client directly, and once through mcp-scout's real `buildGateway()`. Both payloads are tokenized with [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) (`o200k_base`).

| | Tools exposed | JSON bytes | Tokens (o200k_base) |
|---|---|---|---|
| Direct (6 servers connected individually) | 85 | 24,346 | 5,252 |
| Via mcp-scout | 3 | 1,687 | 376 |
| **Reduction** | — | **93.1%** | **92.8%** |

The gateway's exposed schema is constant — 3 tools, ~376 tokens — regardless of how many downstream servers or tools are configured behind it.

**Cost of calling one tool: without mcp-scout vs with.** Without mcp-scout, a client must have every downstream tool's schema loaded before it can call *any* of them, so calling even one tool costs the full 5,252-token upfront payload above. With mcp-scout, calling one tool costs only the 376-token meta-tool upfront cost plus that tool's own `search_tools` + `describe_tools` round:

| To call... | Without mcp-scout | With mcp-scout | Reduction |
|---|---|---|---|
| create an issue | 5,252 | 744 | 85.8% |
| post a message to a channel | 5,252 | 682 | 87.0% |
| read a file | 5,252 | 665 | 87.3% |
| search pages | 5,252 | 651 | 87.6% |
| query database rows | 5,252 | 681 | 87.0% |

Reproduce with:

```
npm run bench
```

(The fixture tool set is a hand-written stand-in at realistic scale, not a literal copy of any real server's schemas — see [`bench/fixtures.ts`](bench/fixtures.ts).)

### Per-task cost, and a real-world run

The upfront number is only half the story — the model still pays to *discover* a tool each task (`search_tools → describe_tools → call_tool`). Three things keep that cost down:

- `search_tools` returns a compact **signature** per hit, so simple tools are callable straight from search — no `describe_tools` round.
- `describe_tools` defaults to a compact signature + parameter table instead of raw JSON Schema, with `detail:"full"` still available. Complex params (enums, nested objects) always keep their raw sub-schema, so compact is never a fidelity loss, and by construction never larger than full.
- `call_tool` echoes the expected signature on a validation error, so wrong-args attempts self-correct without a describe round.

`npm run bench` measures this on the same synthetic fixture set (no live servers needed, since `describe_tools`/`search_tools` are pure functions over the fixture's own JSON Schema):

| | Tokens (o200k_base) |
|---|---|
| Full JSON Schema (all 85 tools) | 5,363 |
| Compact (all 85 tools) | 3,576 |
| **Reduction** | **33.3%** |

Average cost of a full `search_tools` + `describe_tools` round across 5 representative queries (create an issue, post a message, read a file, search pages, query rows): **~309 tokens**.

[`bench/real-bench.ts`](bench/real-bench.ts) runs the whole thing against **real, live MCP servers** (point it at any `.mcp.json`) and captures the upfront number, the without-vs-with per-tool-call comparison, the per-task numbers, and a real end-to-end call. A sample run against 112 live tools (grafana + mongodb + postgres) is checked in at [`bench/REAL-RESULTS.md`](bench/REAL-RESULTS.md): 99.2% upfront reduction, calling any single tool costs 96–99% less than the without-mcp-scout baseline (49,975 tokens down to 714–1,815 depending on the tool), and compact `describe_tools` cuts a fat 1,036-token schema to 876 and a typical one from 603 to 267 — reduction there ranges 15–75% depending on how nested the schema is (the fidelity guarantee bounds the win on heavily-nested ones).

```
tsx bench/real-bench.ts /path/to/mcp.json --out bench/REAL-RESULTS.md --redact
```

`--redact` anonymizes anything from your config before it hits the report: the config's file path, real server names (replaced with generic `kind-N` labels like `mongodb-1`), skip-reason details, and the actual content returned by end-to-end calls (replaced with a byte count). Use it any time the output might be committed or shared — drop it only for a private, local-only run.

## Usage

Point it at a config in the same shape as `.mcp.json` / `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." } },
    "jira": { "url": "https://mcp.example.com/jira", "headers": { "Authorization": "Bearer ..." } }
  }
}
```

Then register mcp-scout itself as the *only* server in your client's config:

```json
{
  "mcpServers": {
    "scout": {
      "command": "npx",
      "args": ["-y", "@raghudr15/mcp-scout", "/path/to/your/mcp-servers.json"]
    }
  }
}
```

### CLI flags

```
mcp-scout [config-path] [--config <path>] [--timeout <ms>]
```

- `config-path` (positional) or `--config` — defaults to `./mcp-scout.json`
- `--timeout` — per-call timeout to downstream servers in milliseconds, default `60000`

## Development

```
npm install
npm run build
npm test
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and PR expectations.

## License

MIT
