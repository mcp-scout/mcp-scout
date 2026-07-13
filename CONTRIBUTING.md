# Contributing

## Local setup

```
npm install
npm run build
npm test
```

Benchmarks (optional, not required for a PR):

```
npm run bench
tsx bench/real-bench.ts /path/to/mcp.json --out bench/REAL-RESULTS.md --redact
```

## Before opening a PR

- Keep changes small and focused — one concern per PR.
- Add or update tests for any behavior change (`test/`). `npm test` must pass.
- Don't reformat unrelated code or files as part of an unrelated change.
- If you touch `src/gateway.ts`'s tool descriptions or `src/schema-render.ts`, re-run the
  benchmarks and check whether `README.md` / `bench/REAL-RESULTS.md` numbers need updating.

## Reporting issues

Open a GitHub issue with the config shape you're using (redact secrets/tokens) and the
error or unexpected behavior you saw.
