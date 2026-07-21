# Client & SDK comparison

Does registering MCP tools directly already defer their schemas, or does mcp-scout add real value
on top? Measured, not assumed: eight tests across two clients and three SDKs, using real headless
runs (Claude Code, Cursor) and real client-library serialization (LangGraph, OpenAI Agents SDK,
Vercel AI SDK) — not estimated. All raw config/results are reproducible; see [Method](#method).

## Summary

| Client / SDK | Scale tested | Direct cost | Via scout | Result |
|---|--:|--:|--:|---|
| Claude Code, stdio servers | 20 tools | +141 tokens | +132 tokens | No measurable benefit |
| Claude Code, HTTP servers | 20 → 105 tools | +318 → +1,934 tokens | +132 → −52 tokens | Real, growing benefit |
| Cursor, stdio servers | 18 → 152 tools | +119 → +328 tokens | +108 → +101 tokens | No measurable benefit |
| LangGraph | 20 tools | 3,196 tokens | 668 tokens | **79.1% reduction** |
| OpenAI Agents SDK | 20 tools | 3,176 tokens | 664 tokens | **79.1% reduction** |
| Vercel AI SDK | 20 tools | 1,668 tokens | 430 tokens | **74.2% reduction** |

**The pattern:** scout's value is proportional to how little optimization a client already does on
its own. Claude Code and Cursor both already keep direct stdio tool registration cheap by default —
scout adds nothing measurable there. Claude Code's HTTP-transport tools aren't deferred as
cheaply, and the gap widens as tool count grows. The three SDKs tested (LangGraph, OpenAI Agents
SDK, Vercel AI SDK) have no built-in schema deferral at all, so scout's reduction there is real and
substantial.

---

## Claude Code — stdio servers

Registered a real downstream MCP server (~20 tools) directly vs. through scout, headless
(`claude -p --strict-mcp-config`), same trivial prompt each time so the only variable is which
servers are registered. Claude Code's native **Tool Search** (on by default) already defers tool
schemas out of the upfront context.

| Config | Total context tokens | Delta vs. no-MCP baseline |
|---|--:|--:|
| Direct (native Tool Search, default) | 39,653 | +141 |
| Raw injection (Tool Search disabled) | 70,083 | +30,571 |
| Via scout | 39,644 | +132 |

Direct and scout land within 9 tokens of each other — noise, not a real difference. Tool Search
alone is already ~99.5% as effective as scout at this scale. (Disabling Tool Search shows what raw
injection would otherwise cost — 30,571 tokens — confirming Tool Search is doing real work, just
not work scout can meaningfully improve on.)

## Claude Code — HTTP-transport servers

Same method, but downstream servers connect over Streamable HTTP instead of stdio, testing a
reported claim that Tool Search doesn't defer HTTP tools the same way. Tested at two scales.

| Config | 20 tools | 105 tools |
|---|--:|--:|
| Direct, native Tool Search | +318 | +1,934 |
| Via scout | +132 | −52 (noise floor) |

HTTP tools cost Tool Search noticeably more per tool than stdio ones (~16-18 tokens/tool vs. ~7-8
for stdio), and that cost scales roughly linearly with tool count. Scout's own cost stays flat
regardless of downstream size (it connects lazily and never touches the downstream for a prompt
that doesn't need a tool) — so **scout's absolute advantage widens as HTTP tool count grows**: 58%
cheaper at 20 tools, and the entire added cost is gone (scout lands at the noise floor) at 105
tools. This is the clearest real, reproducible win for scout in either client tested.

## Cursor — stdio servers

Same method via Cursor's CLI (`agent -p --approve-mcps`), tested at two scales: ~18 tools (one real
downstream server) and 152 tools (four real servers, 54 tools configured — Cursor's CLI also merges
in additional MCP servers from an account-level plugin layer beyond the local config, bringing the
effective total to 152).

| Config | 18 tools | 152 tools |
|---|--:|--:|
| Direct | +119 | +328 |
| Via scout | +108 | +101 |

Cursor represents registered tools as compact call signatures by default, not raw JSON Schema —
direct registration is already cheap, and stays cheap at 7-8x the tool count (cost per tool actually
*drops* at scale: ~6.6 tokens/tool at 18 tools vs. ~2.2 tokens/tool at 152). No tool-count cap was
observed at 152 tools in the CLI, despite forum reports of a ~40-tool cap in the Cursor IDE — that
may be IDE-specific behavior not tested here.

## LangGraph

`langchain-mcp-adapters`'s `MultiServerMCPClient.get_tools()` wraps each MCP tool verbatim into a
LangChain `BaseTool`, with no filtering or deferral logic — documented fact, not a testable
assumption. The open question was the real token cost: tools were converted to the actual OpenAI
function-calling wire format via `langchain_core.utils.function_calling.convert_to_openai_tool` (no
live model call — no API key available in this environment) and tokenized.

| Config | Tools | Tokens |
|---|--:|--:|
| Direct (real OpenAI-tool-format conversion) | 20 | 3,196 |
| Via scout | 4 | 668 |
| **Reduction** | | **79.1%** |

## OpenAI Agents SDK

Same serialization-only method, independent SDK: `agents.mcp.MCPServerStdio` +
`agents.mcp.util.MCPUtil.get_function_tools()`, converted to the SDK's real model-facing wire format
via `agents.models.openai_responses.Converter.convert_tools()`. The SDK does expose a
`defer_loading` flag on tools, but confirmed (by reading its source) that MCP-derived tools never
get it set automatically — no deferral out of the box, matching LangGraph's profile.

| Config | Tools | Tokens |
|---|--:|--:|
| Direct (real Converter.convert_tools output) | 20 | 3,176 |
| Via scout | 4 | 664 |
| **Reduction** | | **79.1%** |

Nearly identical to LangGraph's numbers (3,176 vs. 3,196 direct; 664 vs. 668 via scout) — two
independent SDKs, two independent converters, same result. Strong evidence this is a real property
of the tool-set-size difference, not an artifact of one SDK's serialization quirks.

## Vercel AI SDK

Same method, third SDK: `createMCPClient({ transport }).tools()` from `@ai-sdk/mcp`, using its
stdio transport (`Experimental_StdioMCPTransport`). Measured the SDK's real internal tool
representation (name, description, JSON Schema) rather than a fully provider-converted wire format
— this SDK only builds that final wrapper at model-call time, which requires a live call this
session didn't have credentials for. So this number sits one layer earlier in the pipeline than the
LangGraph/OpenAI figures above; the true wire-format reduction is likely close to their ~79%, not
meaningfully lower.

| Config | Tools | Tokens |
|---|--:|--:|
| Direct (real `ToolSet` objects) | 20 | 1,668 |
| Via scout | 4 | 430 |
| **Reduction** | | **74.2%** |

---

## Method

- **Claude Code / Cursor**: ephemeral, headless CLI runs (`claude -p --strict-mcp-config`,
  `agent -p --approve-mcps`), same trivial prompt each time so tool registration is the only
  variable. Both CLIs split token usage across `input`/`cache_read`/`cache_write` fields (prompt
  caching) — the numbers above are the sum of all three, not raw input tokens alone.
- **LangGraph / OpenAI Agents SDK / Vercel AI SDK**: no live model call (no API key available) —
  each SDK's own tool-listing and conversion functions were used to build the real payload a model
  would receive, then tokenized with `gpt-tokenizer` (`o200k_base`). All three tests reused the same
  synthetic 20-tool stdio fixture for comparability.
- Every test confirmed real, non-empty tool counts before trusting any token number, to rule out a
  silent connection failure being mistaken for a result.
- The Cursor tests temporarily modified a real `~/.cursor/mcp.json`, backed up and restored with
  SHA-256 verification before and after.
- Real API usage was incurred for the Claude Code/Cursor tests (a handful of dollars total); the
  three SDK tests made no live model API calls.

## Still open (not measured here)

- The ~40-tool cap reported in the **Cursor IDE** specifically (as opposed to the CLI tested here).
- A live end-to-end model call for the three SDKs (serialization-only was used instead).
- The Claude Agent SDK (distinct from the Claude Code app) — no Tool Search equivalent exposed there
  per open feature requests, not measured directly.
