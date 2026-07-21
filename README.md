# mcp-scout

[![CI](https://github.com/mcp-scout/mcp-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/mcp-scout/mcp-scout/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40mcp-scout%2Fmcp-scout.svg)](https://www.npmjs.com/package/@mcp-scout/mcp-scout)
[![license](https://img.shields.io/npm/l/%40mcp-scout%2Fmcp-scout.svg)](LICENSE)

**One MCP server that stands in for all your other ones**, so your agent sees 4 tools instead of
however many your downstream servers add up to — schemas loaded on demand via search, not dumped
into context up front.

Open source, MIT licensed — contributions welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Contents

- [The problem](#the-problem)
- [What this does](#what-this-does)
- [Quick start](#quick-start)
- [How this compares](#how-this-compares)
- [Where it fits](#where-it-fits)
- [Benchmark](#benchmark)
- [Search strategy](#search-strategy)
- [Development](#development)

## The problem

Connect an MCP client to a handful of servers and, in most clients and SDKs, every tool's full JSON
schema loads into the model's context before it does anything. In this project's own benchmark,
4 real MCP servers (50 tools) with no schema deferral cost **34,468 tokens** of upfront schema —
before a single tool was ever called (see [Benchmark](#benchmark)).

That said — measure, don't assume: in the two clients most people would reach for first, **Claude
Code and Cursor already keep direct tool registration cheap by default** (native Tool Search, and a
compact tool representation, respectively). mcp-scout adds no measurable token benefit in either.
It has a real niche elsewhere — see [Where it fits](#where-it-fits) for the honest, measured
breakdown of where it helps, where it's redundant, and what's still unverified.

## What this does

Instead of connecting your client directly to N servers, point it at mcp-scout — it connects to all
of them for you. Your client sees exactly **4 tools**, no matter how many servers or tools sit
behind it:

```
                 ┌──────────────┐      github    (20 tools)
 your client ──▶ │  mcp-scout   │──▶  slack      (12 tools)
 (sees 4 tools)  │ (4 meta-tools)│──▶  jira       (15 tools)
                 └──────────────┘──▶  ...and more, hidden until searched
```

- **`search_tools(query, limit?)`** — keyword search over every downstream tool's name and
  description. Each match returns `server.toolName`, a compact call **signature**
  (`server.tool(a: string!, b?: number)`), and a short description — not the full schema. For simple
  tools the signature is enough to call directly.
- **`describe_tools(names[], detail?)`** — parameter details for specific tools. Defaults to a
  compact signature + parameter table (a fraction of the tokens of raw JSON Schema); pass
  `detail:"full"` for the raw JSON Schema. Complex params (enums, nested objects) always keep their
  full sub-schema, so nothing is lost.
- **`call_tool(name, args)`** — call a downstream tool by its namespaced name (`server.toolName`).
  If the args fail validation, the error echoes the expected signature so the model can self-correct
  without another round trip.
- **`list_servers()`** — report which downstream servers are connected (with tool counts) and which
  failed (with the reason), so the model can avoid calling tools on a server that's currently down.

Downstream servers connect lazily (only once actually needed) and their tool lists are cached and
kept fresh via `notifications/tools/list_changed`. A downstream server that fails to start or
crashes shows up as a warning, not a crash.

## Quick start

No install needed — run it directly with `npx`:

```
npx -y @mcp-scout/mcp-scout /path/to/your/mcp-servers.json
```

**1. Write a downstream config**, same shape as `.mcp.json` / `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "GITHUB_TOKEN": "..." } },
    "jira": { "url": "https://mcp.example.com/jira", "headers": { "Authorization": "Bearer ..." } }
  }
}
```

**2. Register mcp-scout as the *only* server** in your client's config, pointing at that file:

```json
{
  "mcpServers": {
    "scout": {
      "command": "npx",
      "args": ["-y", "@mcp-scout/mcp-scout", "/path/to/your/mcp-servers.json"]
    }
  }
}
```

That's it — your client now sees 4 tools that search and call all of the servers in step 1.

Prefer a global install? `npm install -g @mcp-scout/mcp-scout`, then run the plain `mcp-scout`
command instead of `npx -y @mcp-scout/mcp-scout`.

<details>
<summary><b>CLI flags</b></summary>

```
mcp-scout [config-path] [--config <path>] [--timeout <ms>] [--search <strategy>]
```

- `config-path` (positional) or `--config` — defaults to `./mcp-scout.json`
- `--timeout` — per-call timeout to downstream servers in milliseconds, default `60000`
- `--search` — which search strategy `search_tools` uses; overrides the config file. Default
  `bm25`. An unknown name fails fast at startup with the list of available strategies.

</details>

### Using it from an SDK

mcp-scout is a standard MCP server, so any MCP-capable SDK can use it two ways:

- **As the one MCP server** (works everywhere, any language) — same `npx` command as above. Drop it
  into LangGraph's `MultiServerMCPClient`, the Claude Agent SDK's MCP config, or Cursor's
  `.cursor/mcp.json` — same as any other stdio MCP server.
- **As a Node/TS library** — `import { buildGateway, Registry } from "@mcp-scout/mcp-scout"` to run
  the gateway in-process (type declarations included). Node/TS only; from Python SDKs, use the
  MCP-server form above.

## How this compares

Several projects aggregate multiple MCP servers behind one endpoint. Most default to solving
*connection* sprawl (one client config instead of N) while still handing the model every downstream
schema up front — they don't default to solving the *context* tax. This project defaults to the
opposite: search-first, schemas on demand, with nothing else.

| | mcp-scout | [MetaMCP](https://github.com/metatool-ai/metamcp) | [1mcp/agent](https://github.com/1mcp-app/agent) | [mcgravity](https://github.com/tigranbs/mcgravity) |
|---|---|---|---|---|
| Client sees, by default | 4 meta-tools, always | All downstream tools (flat, namespaced) | All downstream tools (flat, via `serve`) | All downstream tools (per backend) |
| Schema-on-demand option | Yes — the only mode | No | Yes — separate CLI mode (`instructions`/`inspect`/`run`), opt-in, not the default `serve` behavior | No |
| Primary goal | Cut context-window tax | Aggregation + middleware + RBAC | Aggregation + OAuth 2.1 | Load balancing / horizontal scaling |
| Tool discovery | `search_tools` keyword search | Browse full list / namespace UI | Browse full list (default) or CLI inspect flow | Browse full list per backend |
| Runtime | Single Node process, `npx` | Docker (Next.js app + Postgres) | Node process | Go binary |
| Setup | Point at a `.mcp.json`-shaped file, run | Web UI, DB-backed config | Config file / env | Nginx-style config |
| Extra features | — (intentionally minimal) | Namespaces, RBAC, middleware, web UI | OAuth 2.1, per-client/session templating | Load balancing, failover |

1mcp/agent is the closest in spirit — its CLI mode does progressive tool discovery too — but it's an
alternate mode layered on top of a primarily flat aggregator, whereas this project has no flat mode
at all.

If you already need RBAC, a web UI, or load balancing, those tools cover more ground. If your actual
problem is "my agent's context is 70% tool schemas before it does anything," this is the narrower
tool built specifically for that.

## Where it fits

mcp-scout works at the **MCP layer**, so it's **client- and model-agnostic**. That sounds like it
should help everywhere — it doesn't. Two clients were tested directly, headless, with real token
accounting (not estimated). The rest of this table is inferred from documentation, not measured the
same way — marked accordingly, because two out of two measured assumptions in this project have
already turned out wrong once tested.

| Client / SDK | Tool registration cost | mcp-scout help? | Verified how |
|---|---|---|---|
| **Claude Code** (app / CLI) | Tiny — native Tool Search, on by default | **No measurable benefit** on stdio servers; a real, growing benefit on HTTP servers as tool count scales up | ✅ Measured (headless, token deltas, two transports, two scales) |
| **Cursor** (app / CLI) | Tiny — compact tool representation by default, not raw JSON Schema | **No measurable benefit on tokens**, even at 152 tools. May still help bypass Cursor's reported ~40-tool cap in the IDE — untested here (only the CLI was tested) | ✅ Tokens measured at two scales; IDE cap **not** tested |
| **Claude API** | Full schema unless you opt in to `defer_loading` (Anthropic models only) | Optional, if you don't set `defer_loading` | Not measured |
| **Claude Agent SDK** (Python / TS) | Reportedly full schema injection — Tool Search not yet exposed there (open feature requests) | Likely helps | Not measured — inferred from docs |
| **LangGraph, OpenAI Agents SDK, Vercel AI SDK** | No built-in schema deferral | **Yes — 74-79% token reduction, measured** via each SDK's real tool-serialization output | ✅ Measured (serialization-only, no live model call) |
| **Windsurf, Cline, VS Code Copilot** | Reportedly full schema injection | Likely helps | Not measured — inferred from docs |

**Rule of thumb, stated honestly:** in Claude Code and Cursor, for ordinary stdio-connected
servers, mcp-scout does not save tokens — both already keep direct registration cheap. It earns its
keep in three SDKs with no built-in optimization (LangGraph, OpenAI Agents SDK, Vercel AI SDK —
~74-79% fewer tokens, measured), and in Claude Code specifically once servers are HTTP-transport and
the tool count climbs.

See [`docs/CLIENT_COMPARISON.md`](docs/CLIENT_COMPARISON.md) for the full measured breakdown across
all 8 tests, including the larger-scale retests (Cursor at 152 tools, Claude Code HTTP at 105
tools).

## Benchmark

Measured, not estimated: [`bench/run.ts`](bench/run.ts) builds a synthetic-but-realistic fixture set
— 6 servers modeled at the scale of GitHub, Slack, Jira, Drive, filesystem, and Notion — and
tokenizes the *actual* `tools/list` response both ways (direct vs. through mcp-scout's real
`buildGateway()`) with [`gpt-tokenizer`](https://www.npmjs.com/package/gpt-tokenizer) (`o200k_base`).

> **What "Direct" means here:** the raw-injection baseline — every downstream tool's full schema,
> no deferral. That's the real cost in SDKs with no built-in optimization (LangGraph, OpenAI Agents
> SDK, Vercel AI SDK, the Claude Agent SDK). It is **not** representative of the Claude Code app or
> Cursor, both of which already defer schemas by default and land within noise of mcp-scout's own
> cost for ordinary stdio servers — see [Where it fits](#where-it-fits) for those numbers instead.

| | Tools exposed | JSON bytes | Tokens (o200k_base) |
|---|---|---|---|
| Direct (raw injection, no native deferral) | 85 | 24,346 | 5,252 |
| Via mcp-scout | 4 | 2,082 | 461 |
| **Reduction** | — | **91.4%** | **91.2%** |

The gateway's exposed schema is constant — 4 tools, ~461 tokens — regardless of how many downstream
servers or tools are configured behind it. Calling one tool without mcp-scout costs the full
5,252-token payload above (every schema must already be loaded); with mcp-scout it costs the 461
tokens plus a small `search_tools` + `describe_tools` round:

| To call... | Without mcp-scout | With mcp-scout | Reduction |
|---|---|---|---|
| create an issue | 5,252 | 829 | 84.2% |
| post a message to a channel | 5,252 | 767 | 85.4% |
| read a file | 5,252 | 750 | 85.7% |
| search pages | 5,252 | 736 | 86.0% |
| query database rows | 5,252 | 766 | 85.4% |

Reproduce with `npm run bench`. (The fixture tool set is a hand-written stand-in at realistic scale,
not a literal copy of any real server's schemas — see [`bench/fixtures.ts`](bench/fixtures.ts).)

<details>
<summary><b>Per-task cost, and a real-world run against live servers</b></summary>

The upfront number is only half the story — the model still pays to *discover* a tool each task
(`search_tools → describe_tools → call_tool`). Three things keep that cost down:

- `search_tools` returns a compact **signature** per hit, so simple tools are callable straight from
  search — no `describe_tools` round.
- `describe_tools` defaults to a compact signature + parameter table instead of raw JSON Schema,
  with `detail:"full"` still available. Complex params (enums, nested objects) always keep their raw
  sub-schema, so compact is never a fidelity loss, and by construction never larger than full.
- `call_tool` echoes the expected signature on a validation error, so wrong-args attempts
  self-correct without a describe round.

`npm run bench` measures compact vs. full on the same synthetic fixture set:

| | Tokens (o200k_base) |
|---|---|
| Full JSON Schema (all 85 tools) | 5,363 |
| Compact (all 85 tools) | 3,576 |
| **Reduction** | **33.3%** |

Average cost of a full `search_tools` + `describe_tools` round across 5 representative queries:
**~309 tokens**.

[`bench/real-bench.ts`](bench/real-bench.ts) runs the whole thing against **real, live MCP
servers** (point it at any `.mcp.json`). A sample run (mongodb + postgres, 50 live tools) is checked
in at [`bench/REAL-RESULTS.md`](bench/REAL-RESULTS.md): 98.7% upfront reduction, calling any single
tool costs ~97-98% less than the raw-injection baseline (34,468 tokens down to 734-1,058 depending
on the tool), and compact `describe_tools` cuts a heavy 1,891-token schema to 1,472 and a typical one
from 603 to 267 (reduction ranges ~22-75% depending on how nested the schema is — the fidelity
guarantee bounds the win on heavily-nested ones). Exact totals shift run-to-run with which
downstream servers connect.

```
tsx bench/real-bench.ts /path/to/mcp.json --out bench/REAL-RESULTS.md --redact
```

`--redact` anonymizes anything from your config before it hits the report: the config's file path,
real server names (replaced with generic `kind-N` labels like `mongodb-1`), skip-reason details, and
the actual content returned by end-to-end calls (replaced with a byte count). Use it any time the
output might be committed or shared — drop it only for a private, local-only run.

</details>

## Search strategy

`search_tools` ranking is pluggable. The default (`bm25`) is a BM25-flavored keyword ranker over
each tool's name, description, and server name. Select it in the config file:

```json
{
  "mcpServers": { "...": {} },
  "search": { "strategy": "bm25" }
}
```

`--search <strategy>` overrides the config value. Only `bm25` ships built-in today.

<details>
<summary><b>Custom strategy (library use)</b></summary>

If you embed mcp-scout as a Node/TS library, pass your own ranker to `buildGateway` — it receives the
tool index and returns scored matches:

```ts
import { buildGateway } from "@mcp-scout/mcp-scout";
import type { SearchStrategy } from "@mcp-scout/mcp-scout";

const mySearch: SearchStrategy = (index, query, limit) => {
  // index: { server, name, description }[]  →  return ScoredMatch[] (may be async)
  return index
    .filter((t) => t.name.includes(query))
    .slice(0, limit)
    .map((t) => ({ id: `${t.server}.${t.name}`, ...t, score: 1 }));
};

const gateway = buildGateway(registry, { search: mySearch });
```

</details>

## Development

```
npm install
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and PR expectations.

## License

MIT
