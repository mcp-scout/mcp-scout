# mcp-scout — real-world token benchmark

Source: a local `mcp.json`-style config with 7 servers configured (path and server identities redacted).
Tokenizer: `o200k_base` (gpt-tokenizer), matching GPT-4o / modern context accounting.

## Servers measured

| Server | Tools | Status |
|---|--:|---|
| mongodb-1 | 16 | connected |
| mongodb-2 | 16 | connected |
| grafana-1 | — | skipped: connection failed |
| server-1 | — | skipped: authentication failed |
| mongodb-3 | — | skipped: timed out |
| postgres-1 | — | skipped: timed out |
| postgres-2 | — | skipped: timed out |
| **Total (connected)** | **32** | |

## Upfront context cost (paid on EVERY turn)

**"Direct" = raw injection, no schema deferral** — the real cost in Cursor, LangGraph, the Claude Agent SDK, and most MCP-SDK clients. It is NOT the Claude Code app's cost: that app defers schemas itself by default (native Tool Search) and starts well below this number.

| | Tools exposed | JSON bytes | Tokens |
|---|--:|--:|--:|
| Direct (raw injection, no native deferral; all servers connected) | 32 | 77,231 | 17,226 |
| Via mcp-scout | 4 | 2,082 | 461 |
| **Reduction** | | **97.3%** | **97.3%** |

## Cost of a single tool call: without mcp-scout vs with

Without mcp-scout (raw injection, no native deferral), a client must have every downstream tool's schema loaded before it can call *any* of them — so calling even one tool costs the full 17,226-token upfront payload. With mcp-scout, calling one tool costs only the 461-token meta-tool upfront cost plus that tool's own `search_tools` + `describe_tools` round:

| To call... | Without mcp-scout | With mcp-scout | Reduction |
|---|--:|--:|--:|
| list database collections | 17,226 | 766 | 95.6% |
| query rows from a table | 17,226 | 1,102 | 93.6% |
| search dashboards | 17,226 | 1,029 | 94.0% |

## Per-task cost via mcp-scout (search_tools + describe_tools)

| Query | Top hit | search tokens | describe tokens | task total |
|---|---|--:|--:|--:|
| list database collections | mongodb-2.list-collections | 278 | 27 | 305 |
| query rows from a table | mongodb-1.find | 373 | 268 | 641 |
| search dashboards | mongodb-1.search-knowledge | 328 | 240 | 568 |
| **Average** | | | | **505** |

## describe_tools: compact (default) vs full JSON Schema

Same tools, described both ways. Compact is the default; `detail:"full"` returns raw JSON Schema.

| Tool | full tokens | compact tokens | reduction |
|---|--:|--:|--:|
| mongodb-2.find | 603 | 267 | 55.7% |
| mongodb-2.aggregate | 1,891 | 1,472 | 22.2% |
| **Total** | **2,494** | **1,739** | **30.3%** |

## Round-trip elimination

- `search_tools` now returns a compact call **signature** per hit, so simple tools can be called straight from search — no `describe_tools` round.
- `call_tool` echoes the expected signature when args are wrong, so the model self-corrects without a describe round. Live example (`mongodb-2.find` called with a bogus param):

```
Expected arguments: mongodb-2.find(database: string!, collection: string!, filter?: object, projection?: object, limit?: number, sort?: object, responseBytesLimit?: number)
```

## Break-even analysis

- Direct pays **17,226 tokens up front, every turn**.
- mcp-scout pays **461 tokens up front**, plus ~**505 tokens** per tool actually used.
- Even if a session uses several tools, scout stays far below the direct baseline: you would need ~**33 tool lookups in a single turn** before scout's per-turn cost caught up with direct.

## End-to-end correctness

Ran real `call_tool` requests through the gateway to live downstream servers:

### `mongodb-2.list-databases` — ⚠️ returned error
```
(real data returned — 132 chars, content redacted)
```

### `mongodb-1.list-databases` — ⚠️ returned error
```
(real data returned — 132 chars, content redacted)
```

