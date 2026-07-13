import { describe, expect, it } from "vitest";
import { searchTools, type IndexedTool } from "../src/search.js";

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
