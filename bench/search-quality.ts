// Search ranking quality benchmark — measured, not assumed. Runs a labeled set
// of realistic queries against the bm25 strategy and reports precision@1/@3,
// so a future ranking change can't silently regress without anyone noticing.
//
// Corpus: the existing 85-tool synthetic fixture set (bench/fixtures.ts), plus
// two extra synthetic servers added here (monitoring, database) to recreate the
// cross-domain ambiguity pattern this project has actually observed in
// production (e.g. a generic "search"-named tool on one server competing with
// a domain-specific tool on another) — without using any real company/server
// names.
import { resolveSearchStrategy, type IndexedTool } from "../src/search.js";
import { FIXTURE_SERVERS, toolListFor, type ServerFixture } from "./fixtures.js";

const EXTRA_SERVERS: ServerFixture[] = [
  {
    name: "monitoring",
    tools: [
      { name: "search_dashboards", description: "Search dashboards by name or tag", params: [{ name: "query", type: "string", description: "Search query", required: true }] },
      { name: "list_datasources", description: "List configured data sources", params: [] },
      { name: "get_dashboard", description: "Get a dashboard by UID", params: [{ name: "uid", type: "string", description: "Dashboard UID", required: true }] },
    ],
  },
  {
    name: "database",
    tools: [
      { name: "execute_query", description: "Run a SQL query against a database and return rows", params: [{ name: "sql", type: "string", description: "SQL query text", required: true }] },
      { name: "list_tables", description: "List tables in a database", params: [{ name: "database", type: "string", description: "Database name", required: true }] },
      { name: "describe_table", description: "Get column schema for a table", params: [{ name: "table", type: "string", description: "Table name", required: true }] },
    ],
  },
];

type LabeledQuery = { query: string; expected: string; tier: "easy" | "disambiguation" | "hard" };

const QUERIES: LabeledQuery[] = [
  // Easy: unambiguous single-intent queries.
  { query: "list pull requests", expected: "github.list_pull_requests", tier: "easy" },
  { query: "post a message to a channel", expected: "slack.post_message", tier: "easy" },
  { query: "log work time on an issue", expected: "jira.add_worklog", tier: "easy" },
  { query: "share a file with someone", expected: "drive.share_file", tier: "easy" },
  { query: "create a new page", expected: "notion.create_page", tier: "easy" },
  { query: "list branches in a repo", expected: "github.list_branches", tier: "easy" },
  { query: "get sprint details", expected: "jira.get_sprint", tier: "easy" },
  { query: "add an emoji reaction", expected: "slack.add_reaction", tier: "easy" },
  { query: "list configured data sources", expected: "monitoring.list_datasources", tier: "easy" },
  { query: "list tables in a database", expected: "database.list_tables", tier: "easy" },

  // Disambiguation: same tool name exists on two servers — tests the
  // server-name-in-index fix (a query naming the server should win).
  { query: "github create issue", expected: "github.create_issue", tier: "disambiguation" },
  { query: "jira create issue", expected: "jira.create_issue", tier: "disambiguation" },
  { query: "github update issue state", expected: "github.update_issue", tier: "disambiguation" },
  { query: "jira update issue summary", expected: "jira.update_issue", tier: "disambiguation" },
  { query: "search files in drive", expected: "drive.search_files", tier: "disambiguation" },
  { query: "search files on filesystem by pattern", expected: "filesystem.search_files", tier: "disambiguation" },
  { query: "monitoring search dashboards", expected: "monitoring.search_dashboards", tier: "disambiguation" },

  // Hard: vague or cross-domain queries where a generic same-keyword tool on
  // an unrelated server could plausibly outrank the intended one.
  { query: "search dashboards", expected: "monitoring.search_dashboards", tier: "hard" },
  { query: "query rows from a table", expected: "database.execute_query", tier: "hard" },
  { query: "search for pages", expected: "notion.search", tier: "hard" },
  { query: "search for messages", expected: "slack.search_messages", tier: "hard" },
  { query: "search code", expected: "github.search_code", tier: "hard" },
];

function buildIndex(): { index: IndexedTool[]; totalTools: number } {
  const allServers = [...FIXTURE_SERVERS, ...EXTRA_SERVERS];
  const index: IndexedTool[] = allServers.flatMap((fixture) =>
    toolListFor(fixture).map((t) => ({ server: fixture.name, name: t.name, description: t.description })),
  );
  return { index, totalTools: index.length };
}

async function main(): Promise<void> {
  const { index, totalTools } = buildIndex();
  const search = resolveSearchStrategy("bm25");

  const rows: string[] = [];
  const tierStats: Record<LabeledQuery["tier"], { hit1: number; hit3: number; total: number }> = {
    easy: { hit1: 0, hit3: 0, total: 0 },
    disambiguation: { hit1: 0, hit3: 0, total: 0 },
    hard: { hit1: 0, hit3: 0, total: 0 },
  };

  for (const { query, expected, tier } of QUERIES) {
    const matches = await search(index, query, 5);
    const top1 = matches[0]?.id ?? "(none)";
    const top3 = matches.slice(0, 3).map((m) => m.id);
    const hit1 = top1 === expected;
    const hit3 = top3.includes(expected);
    tierStats[tier].total++;
    if (hit1) tierStats[tier].hit1++;
    if (hit3) tierStats[tier].hit3++;
    rows.push(`| ${tier} | ${query} | ${expected} | ${top1} | ${hit1 ? "✅" : "❌"} | ${hit3 ? "✅" : "❌"} |`);
  }

  const totalHit1 = Object.values(tierStats).reduce((a, s) => a + s.hit1, 0);
  const totalHit3 = Object.values(tierStats).reduce((a, s) => a + s.hit3, 0);

  console.log(`Corpus: ${FIXTURE_SERVERS.length + EXTRA_SERVERS.length} servers, ${totalTools} tools\n`);
  console.log("| Tier | Query | Expected | Top hit | Hit@1 | Hit@3 |");
  console.log("|---|---|---|---|---|---|");
  for (const row of rows) console.log(row);
  console.log();
  console.log(`Precision@1 (overall): ${totalHit1}/${QUERIES.length} (${((100 * totalHit1) / QUERIES.length).toFixed(1)}%)`);
  console.log(`Precision@3 (overall): ${totalHit3}/${QUERIES.length} (${((100 * totalHit3) / QUERIES.length).toFixed(1)}%)`);
  console.log();
  for (const tier of ["easy", "disambiguation", "hard"] as const) {
    const s = tierStats[tier];
    console.log(`  ${tier}: precision@1 ${s.hit1}/${s.total}, precision@3 ${s.hit3}/${s.total}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
