# mcp-scout — real-world token benchmark

Source: a local `mcp.json`-style config with 7 servers configured (path and server identities redacted).
Tokenizer: `o200k_base` (gpt-tokenizer), matching GPT-4o / modern context accounting.

## Servers measured


| Server                | Tools   | Status                         |
| --------------------- | ------- | ------------------------------ |
| grafana-1             | 58      | connected                      |
| mongodb-1             | 18      | connected                      |
| mongodb-2             | 18      | connected                      |
| postgres-1            | 9       | connected                      |
| postgres-2            | 9       | connected                      |
| server-1              | —       | skipped: authentication failed |
| mongodb-3             | —       | skipped: connection failed     |
| **Total (connected)** | **112** |                                |


## Upfront context cost (paid on EVERY turn)


|                                | Tools exposed | JSON bytes | Tokens    |
| ------------------------------ | ------------- | ---------- | --------- |
| Direct (all servers connected) | 112           | 216,075    | 49,975    |
| Via mcp-scout                  | 3             | 1,687      | 376       |
| **Reduction**                  |               | **99.2%**  | **99.2%** |


**Upfront cost, before vs after adding round-trip elimination** (inlined signatures in `search_tools`, the `detail` param on `describe_tools`, and the self-correcting `call_tool` error text):


|                                | JSON bytes        | Tokens           |
| ------------------------------ | ----------------- | ---------------- |
| Before (original 3 meta-tools) | 1,462             | 330              |
| After (current)                | 1,687             | 376              |
| **Change**                     | **+225 (+15.4%)** | **+46 (+13.9%)** |


That's the one-time cost of describing the new capabilities, paid once upfront — far smaller than the per-task savings those same capabilities unlock below.

## Per-task cost via mcp-scout (search_tools + describe_tools)


| Query                     | Top hit                     | search tokens | describe tokens | task total |
| ------------------------- | --------------------------- | ------------- | --------------- | ---------- |
| list database collections | mongodb-2.list-collections  | 310           | 27              | 337        |
| query rows from a table   | grafana-1.update_dashboard  | 563           | 876             | 1439       |
| search dashboards         | grafana-1.search_dashboards | 381           | 87              | 468        |
| **Average**               |                             |               |                 | **748**    |




## describe_tools: compact (default) vs full JSON Schema

Same tools, described both ways. Compact is the default; `detail:"full"` returns raw JSON Schema.


| Tool                        | full tokens | compact tokens | reduction |
| --------------------------- | ----------- | -------------- | --------- |
| grafana-1.update_dashboard  | 1,036       | 876            | 15.4%     |
| grafana-1.search_dashboards | 176         | 87             | 50.6%     |
| mongodb-2.find              | 603         | 267            | 55.7%     |
| mongodb-2.aggregate         | 1,891       | 1,472          | 22.2%     |
| postgres-1.execute_sql      | 98          | 25             | 74.5%     |
| **Total**                   | **3,804**   | **2,727**      | **28.3%** |




## Round-trip elimination

- `search_tools` now returns a compact call **signature** per hit, so simple tools can be called straight from search — no `describe_tools` round.
- `call_tool` echoes the expected signature when args are wrong, so the model self-corrects without a describe round. Live example (`mongodb-2.find` called with a bogus param):

```
Expected arguments: mongodb-2.find(database: string!, collection: string!, filter?: object, projection?: object, limit?: number, sort?: object, responseBytesLimit?: number)
```



## Break-even analysis

- Direct pays **49,975 tokens up front, every turn**.
- mcp-scout pays **376 tokens up front**, plus ~**748 tokens** per tool actually used.
- Even if a session uses several tools, scout stays far below the direct baseline: you would need ~**66 tool lookups in a single turn** before scout's per-turn cost caught up with direct.



## End-to-end correctness

Ran real `call_tool` requests through the gateway to live downstream servers:

### `mongodb-2.list-databases` — ✅ success (isError=false)

```
(real data returned — 20 chars, content redacted)
```



### `mongodb-1.list-databases` — ✅ success (isError=false)

```
(real data returned — 18 chars, content redacted)
```



### `postgres-1.list_schemas` — ✅ success (isError=false)

```
(real data returned — 381 chars, content redacted)
```



### `postgres-2.list_schemas` — ✅ success (isError=false)

```
(real data returned — 400 chars, content redacted)
```



### `grafana-1.list_datasources` — ✅ success (isError=false)

```
(real data returned — 400 chars, content redacted)
```

