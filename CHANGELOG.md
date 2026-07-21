# Changelog

All notable changes to this project are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.2] - 2026-07-21

### Added
- Pluggable, tunable search strategy: `createBm25Strategy(options)` and per-deployment weighting
  via the config file or `--search` CLI flag, instead of hardcoded ranking weights.
- `list_servers` meta-tool — reports which downstream servers are connected (with tool counts) and
  which failed (with the reason).
- Automatic reconnect for transient downstream failures (e.g. `-32000`/"Connection closed"),
  covered by a real integration test that kills and respawns a subprocess mid-session.
- `bench/search-quality.ts` — a precision@1/@3 regression benchmark for search ranking (95.5%/100%
  across 22 labeled queries), plus cross-server disambiguation regression tests in `test/search.test.ts`.
- `docs/CLIENT_COMPARISON.md` — real, measured comparisons against Claude Code (stdio + HTTP
  transport, two scales each), Cursor (stdio, two scales), LangGraph, OpenAI Agents SDK, and Vercel
  AI SDK, replacing earlier assumption-based claims.

### Fixed
- The gateway's reported version is now read from `package.json` at runtime (`src/version.ts`)
  instead of a hardcoded string that had drifted out of sync.
- Removed an internal server-naming fragment (`*-extranet-*`) that had leaked into
  `bench/real-bench.ts`'s sample-tool candidate lists.

### Note
- `0.1.1` was published to npm and then unpublished; npm permanently blocks reusing a version
  string once it's been published, so this release (containing everything above, plus what was
  originally intended for `0.1.1`) ships as `0.1.2` instead.

## [0.1.0] - 2026-07-13

### Added
- Initial release: `search_tools`, `describe_tools`, and `call_tool` meta-tools, so a client sees 4
  tools instead of every downstream server's full schema.
- `Registry` (downstream connection management) and `buildGateway` (the MCP server itself).
- Compact schema rendering (`schema-render.ts`) — signature + parameter table instead of raw JSON
  Schema by default, with `detail:"full"` for the original schema.
- BM25-based `search_tools` ranking.
- Synthetic benchmark (`bench/run.ts`) and real-downstream-server benchmark (`bench/real-bench.ts`),
  both tokenizing actual `tools/list` payloads rather than estimating.
- Test suite, CI (build + test on push/PR), MIT license, `CONTRIBUTING.md`.
