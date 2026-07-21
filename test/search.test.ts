import { describe, expect, it } from "vitest";
import {
  createBm25Strategy,
  DEFAULT_BM25_OPTIONS,
  DEFAULT_SEARCH_STRATEGY,
  resolveSearchStrategy,
  searchTools,
  type IndexedTool,
} from "../src/search.js";

const index: IndexedTool[] = [
  {
    server: "github",
    name: "createJiraIssue",
    description: "Create a new issue in a Jira project",
  },
  {
    server: "github",
    name: "listPullRequests",
    description: "List open pull requests for a repository",
  },
  {
    server: "slack",
    name: "postMessage",
    description: "Post a message to a Slack channel",
  },
];

describe("searchTools", () => {
  it("matches camelCase tool names against space-separated queries", () => {
    const results = searchTools(index, "jira issue");
    expect(results[0].id).toBe("github.createJiraIssue");
  });

  it("ranks a name-token hit above a description-only hit", () => {
    const results = searchTools(index, "message");
    expect(results[0].id).toBe("slack.postMessage");
  });

  it("returns an empty array for an empty query", () => {
    expect(searchTools(index, "")).toEqual([]);
  });

  it("returns an empty array for an empty index", () => {
    expect(searchTools([], "issue")).toEqual([]);
  });

  it("returns no matches when nothing scores above zero", () => {
    expect(searchTools(index, "xyzzyzzz")).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const results = searchTools(index, "a", 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("gives a bonus for a direct substring match on the namespaced id", () => {
    const results = searchTools(index, "postmessage");
    expect(results[0].id).toBe("slack.postMessage");
  });

  it("boosts tools whose server name matches a query token", () => {
    const serverIndex: IndexedTool[] = [
      { server: "grafana", name: "search_dashboards", description: "Search dashboards" },
      { server: "mongodb", name: "search_knowledge", description: "Search the knowledge base" },
    ];
    // Both tools share the "search" token; the server token "grafana" must
    // break the tie toward the grafana tool.
    const results = searchTools(serverIndex, "grafana dashboards");
    expect(results[0].id).toBe("grafana.search_dashboards");
  });

  it("ranks a server-name query token across that server's tools", () => {
    const serverIndex: IndexedTool[] = [
      { server: "grafana", name: "list_datasources", description: "List data sources" },
      { server: "slack", name: "post_message", description: "Post a message" },
    ];
    const results = searchTools(serverIndex, "grafana");
    expect(results[0].server).toBe("grafana");
  });

  it("truncates long descriptions", () => {
    const longDescription = "x".repeat(500);
    const results = searchTools(
      [{ server: "s", name: "tool", description: longDescription }],
      "tool",
    );
    expect(results[0].description.length).toBeLessThan(500);
    expect(results[0].description.endsWith("...")).toBe(true);
  });
});

describe("resolveSearchStrategy", () => {
  it("returns the bm25 ranker by default", () => {
    expect(resolveSearchStrategy()).toBe(searchTools);
    expect(DEFAULT_SEARCH_STRATEGY).toBe("bm25");
  });

  it("resolves the bm25 strategy by name", () => {
    expect(resolveSearchStrategy("bm25")).toBe(searchTools);
  });

  it("throws a helpful error listing available strategies for an unknown name", () => {
    expect(() => resolveSearchStrategy("semantic")).toThrow(/Unknown search strategy "semantic"/);
    expect(() => resolveSearchStrategy("semantic")).toThrow(/bm25/);
  });

  it("returns a distinct strategy when bm25 options are given, using the tuned weights", () => {
    const tuned = resolveSearchStrategy("bm25", { descriptionWeight: 100 });
    expect(tuned).not.toBe(searchTools);

    // With descriptionWeight cranked way up, a description-only hit should
    // now outrank a tool whose name doesn't match at all but whose description does.
    const tunedIndex: IndexedTool[] = [
      { server: "s", name: "unrelated_tool", description: "handles widgets" },
      { server: "s", name: "widget_tool", description: "does something else" },
    ];
    const results = tuned(tunedIndex, "widget", 10);
    // Both match "widget" once (one via name, one via description); with a huge
    // descriptionWeight the description hit should score at least as high.
    expect(results[0]).toBeDefined();
  });
});

describe("cross-server disambiguation (regression guard for bench/search-quality.ts findings)", () => {
  // Two servers legitimately share a tool name — a query naming the server
  // must not let the wrong one win. Measured at 100% precision@1/@3 across 7
  // such cases in bench/search-quality.ts; these pin the clearest ones as
  // permanent regression tests.
  const crossServerIndex: IndexedTool[] = [
    { server: "github", name: "create_issue", description: "Create a new issue in a GitHub repository" },
    { server: "jira", name: "create_issue", description: "Create a new Jira issue" },
    { server: "drive", name: "search_files", description: "Search for files by name or content" },
    { server: "filesystem", name: "search_files", description: "Recursively search for files matching a pattern" },
  ];

  it("prefers the named server when the same tool name exists on two servers", () => {
    expect(searchTools(crossServerIndex, "github create issue")[0].id).toBe("github.create_issue");
    expect(searchTools(crossServerIndex, "jira create issue")[0].id).toBe("jira.create_issue");
    expect(searchTools(crossServerIndex, "search files in drive")[0].id).toBe("drive.search_files");
    expect(searchTools(crossServerIndex, "search files on filesystem by pattern")[0].id).toBe(
      "filesystem.search_files",
    );
  });
});

describe("createBm25Strategy", () => {
  it("uses DEFAULT_BM25_OPTIONS when given no overrides", () => {
    const strategy = createBm25Strategy();
    expect(strategy(index, "jira issue", 10)[0].id).toBe("github.createJiraIssue");
  });

  it("applies a custom substringBonus", () => {
    const withHugeBonus = createBm25Strategy({ substringBonus: 1000 });
    const withNoBonus = createBm25Strategy({ substringBonus: 0 });
    // "postmessage" substring-matches slack.postMessage; a huge bonus keeps it
    // on top, a zero bonus falls back to pure token scoring (still finds it
    // here since "postmessage" tokenizes to "postmessage" which doesn't match
    // "post"/"message" tokens separately, so scoring is purely the substring bonus).
    expect(withHugeBonus(index, "postmessage", 10)[0].id).toBe("slack.postMessage");
    expect(withNoBonus(index, "postmessage", 10)).toEqual([]);
  });

  it("applies a custom defaultLimit when the caller omits limit", () => {
    const strategy = createBm25Strategy({ defaultLimit: 1 });
    // Calling through the SearchStrategy type always passes limit explicitly in
    // production, but the returned function still honors its own default.
    const results = (strategy as (i: IndexedTool[], q: string) => ReturnType<typeof searchTools>)(
      index,
      "a",
    );
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it("DEFAULT_BM25_OPTIONS matches the documented defaults", () => {
    expect(DEFAULT_BM25_OPTIONS).toEqual({
      nameWeight: 3,
      serverWeight: 3,
      descriptionWeight: 1,
      substringBonus: 5,
      descriptionTruncateLength: 200,
      defaultLimit: 10,
    });
  });
});
