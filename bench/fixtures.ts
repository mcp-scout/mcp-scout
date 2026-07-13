// Synthetic, representative MCP server fixtures for the context-savings benchmark.
// Tool counts and shapes are modeled on the scale of real popular MCP servers
// (GitHub, Slack, Jira, Drive, filesystem, Notion) but are hand-written stand-ins,
// not literal copies of their actual schemas.

export type ParamSpec = {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description: string;
  required?: boolean;
  items?: { type: string };
};

export type ToolSpec = {
  name: string;
  description: string;
  params: ParamSpec[];
};

export type ServerFixture = {
  name: string;
  tools: ToolSpec[];
};

function toInputSchema(params: ParamSpec[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    properties[p.name] =
      p.type === "array"
        ? { type: "array", items: p.items ?? { type: "string" }, description: p.description }
        : { type: p.type, description: p.description };
    if (p.required) required.push(p.name);
  }
  return required.length > 0
    ? { type: "object", properties, required }
    : { type: "object", properties };
}

export function toolListFor(
  fixture: ServerFixture,
): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return fixture.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toInputSchema(t.params),
  }));
}

const p = (
  name: string,
  type: ParamSpec["type"],
  description: string,
  required = false,
): ParamSpec => ({ name, type, description, required });

export const FIXTURE_SERVERS: ServerFixture[] = [
  {
    name: "github",
    tools: [
      { name: "create_issue", description: "Create a new issue in a GitHub repository", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("title", "string", "Issue title", true), p("body", "string", "Issue body in markdown"), p("labels", "array", "Labels to apply", false, )] },
      { name: "update_issue", description: "Update an existing issue's title, body, state, or labels", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("issue_number", "number", "Issue number", true), p("title", "string", "New title"), p("body", "string", "New body"), p("state", "string", "open or closed")] },
      { name: "get_issue", description: "Get the details of a specific issue", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("issue_number", "number", "Issue number", true)] },
      { name: "list_issues", description: "List issues in a repository with optional filters", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("state", "string", "Filter by state"), p("labels", "array", "Filter by labels")] },
      { name: "add_issue_comment", description: "Add a comment to an existing issue", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("issue_number", "number", "Issue number", true), p("body", "string", "Comment body", true)] },
      { name: "create_pull_request", description: "Open a new pull request between two branches", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("title", "string", "PR title", true), p("head", "string", "Source branch", true), p("base", "string", "Target branch", true), p("body", "string", "PR description")] },
      { name: "get_pull_request", description: "Get the details of a specific pull request", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("pull_number", "number", "PR number", true)] },
      { name: "list_pull_requests", description: "List pull requests in a repository", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("state", "string", "Filter by state")] },
      { name: "merge_pull_request", description: "Merge an open pull request", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("pull_number", "number", "PR number", true), p("merge_method", "string", "merge, squash, or rebase")] },
      { name: "create_or_update_file", description: "Create or update a single file's contents in a repository", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("path", "string", "File path", true), p("content", "string", "File content", true), p("message", "string", "Commit message", true), p("branch", "string", "Target branch")] },
      { name: "get_file_contents", description: "Read the contents of a file or directory from a repository", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("path", "string", "File or directory path", true), p("ref", "string", "Branch, tag, or commit SHA")] },
      { name: "push_files", description: "Push multiple files to a branch in a single commit", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("branch", "string", "Target branch", true), p("files", "array", "Files to push", true), p("message", "string", "Commit message", true)] },
      { name: "create_branch", description: "Create a new branch from an existing ref", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("branch", "string", "New branch name", true), p("from_branch", "string", "Source branch")] },
      { name: "list_branches", description: "List branches in a repository", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true)] },
      { name: "search_repositories", description: "Search for GitHub repositories matching a query", params: [p("query", "string", "Search query", true), p("sort", "string", "Sort field"), p("per_page", "number", "Results per page")] },
      { name: "search_code", description: "Search for code across GitHub matching a query", params: [p("query", "string", "Search query", true), p("per_page", "number", "Results per page")] },
      { name: "fork_repository", description: "Fork a repository into your account or an organization", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("organization", "string", "Target organization")] },
      { name: "create_repository", description: "Create a new repository", params: [p("name", "string", "Repository name", true), p("description", "string", "Repository description"), p("private", "boolean", "Whether the repo is private")] },
      { name: "list_commits", description: "List commits on a branch", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("sha", "string", "Branch name or SHA")] },
      { name: "get_commit", description: "Get the details of a specific commit", params: [p("owner", "string", "Repository owner", true), p("repo", "string", "Repository name", true), p("sha", "string", "Commit SHA", true)] },
    ],
  },
  {
    name: "slack",
    tools: [
      { name: "post_message", description: "Post a message to a Slack channel", params: [p("channel", "string", "Channel ID or name", true), p("text", "string", "Message text", true), p("thread_ts", "string", "Thread timestamp to reply in")] },
      { name: "list_channels", description: "List channels in the workspace", params: [p("exclude_archived", "boolean", "Exclude archived channels"), p("limit", "number", "Max results")] },
      { name: "get_channel_history", description: "Get recent messages from a channel", params: [p("channel", "string", "Channel ID", true), p("limit", "number", "Max messages")] },
      { name: "add_reaction", description: "Add an emoji reaction to a message", params: [p("channel", "string", "Channel ID", true), p("timestamp", "string", "Message timestamp", true), p("emoji", "string", "Emoji name", true)] },
      { name: "get_users", description: "List users in the workspace", params: [p("limit", "number", "Max results")] },
      { name: "get_user_profile", description: "Get a user's profile information", params: [p("user_id", "string", "User ID", true)] },
      { name: "search_messages", description: "Search for messages matching a query", params: [p("query", "string", "Search query", true), p("count", "number", "Max results")] },
      { name: "upload_file", description: "Upload a file to a channel", params: [p("channel", "string", "Channel ID", true), p("content", "string", "File content", true), p("filename", "string", "File name", true)] },
      { name: "create_channel", description: "Create a new channel", params: [p("name", "string", "Channel name", true), p("is_private", "boolean", "Whether the channel is private")] },
      { name: "invite_to_channel", description: "Invite users to a channel", params: [p("channel", "string", "Channel ID", true), p("user_ids", "array", "User IDs to invite", true)] },
    ],
  },
  {
    name: "jira",
    tools: [
      { name: "create_issue", description: "Create a new Jira issue", params: [p("project_key", "string", "Project key", true), p("summary", "string", "Issue summary", true), p("issue_type", "string", "Issue type", true), p("description", "string", "Issue description")] },
      { name: "get_issue", description: "Get the details of a Jira issue", params: [p("issue_key", "string", "Issue key", true)] },
      { name: "update_issue", description: "Update fields on an existing issue", params: [p("issue_key", "string", "Issue key", true), p("summary", "string", "New summary"), p("description", "string", "New description")] },
      { name: "delete_issue", description: "Delete an issue", params: [p("issue_key", "string", "Issue key", true)] },
      { name: "search_issues", description: "Search issues using JQL", params: [p("jql", "string", "JQL query", true), p("max_results", "number", "Max results")] },
      { name: "add_comment", description: "Add a comment to an issue", params: [p("issue_key", "string", "Issue key", true), p("body", "string", "Comment body", true)] },
      { name: "get_comments", description: "Get all comments on an issue", params: [p("issue_key", "string", "Issue key", true)] },
      { name: "transition_issue", description: "Move an issue to a new workflow status", params: [p("issue_key", "string", "Issue key", true), p("transition_id", "string", "Transition ID", true)] },
      { name: "get_transitions", description: "List the available transitions for an issue", params: [p("issue_key", "string", "Issue key", true)] },
      { name: "assign_issue", description: "Assign an issue to a user", params: [p("issue_key", "string", "Issue key", true), p("account_id", "string", "Assignee account ID", true)] },
      { name: "add_worklog", description: "Log work time against an issue", params: [p("issue_key", "string", "Issue key", true), p("time_spent", "string", "Time spent, e.g. 2h", true), p("comment", "string", "Worklog comment")] },
      { name: "get_worklogs", description: "Get worklogs for an issue", params: [p("issue_key", "string", "Issue key", true)] },
      { name: "create_issue_link", description: "Link two issues together", params: [p("issue_key", "string", "Source issue key", true), p("target_issue_key", "string", "Target issue key", true), p("link_type", "string", "Link type", true)] },
      { name: "get_issue_link_types", description: "List available issue link types", params: [] },
      { name: "get_project", description: "Get details of a project", params: [p("project_key", "string", "Project key", true)] },
      { name: "list_projects", description: "List all visible projects", params: [p("max_results", "number", "Max results")] },
      { name: "get_issue_types", description: "List issue types available in a project", params: [p("project_key", "string", "Project key", true)] },
      { name: "create_sprint", description: "Create a new sprint on a board", params: [p("board_id", "number", "Board ID", true), p("name", "string", "Sprint name", true)] },
      { name: "get_sprint", description: "Get details of a sprint", params: [p("sprint_id", "number", "Sprint ID", true)] },
      { name: "move_issues_to_sprint", description: "Move issues into a sprint", params: [p("sprint_id", "number", "Sprint ID", true), p("issue_keys", "array", "Issue keys to move", true)] },
    ],
  },
  {
    name: "drive",
    tools: [
      { name: "search_files", description: "Search for files by name or content", params: [p("query", "string", "Search query", true), p("max_results", "number", "Max results")] },
      { name: "get_file", description: "Get metadata and content for a file", params: [p("file_id", "string", "File ID", true)] },
      { name: "create_file", description: "Create a new file", params: [p("name", "string", "File name", true), p("content", "string", "File content", true), p("parent_folder_id", "string", "Parent folder ID")] },
      { name: "update_file", description: "Update an existing file's content or name", params: [p("file_id", "string", "File ID", true), p("content", "string", "New content"), p("name", "string", "New name")] },
      { name: "delete_file", description: "Delete a file", params: [p("file_id", "string", "File ID", true)] },
      { name: "create_folder", description: "Create a new folder", params: [p("name", "string", "Folder name", true), p("parent_folder_id", "string", "Parent folder ID")] },
      { name: "move_file", description: "Move a file to a different folder", params: [p("file_id", "string", "File ID", true), p("new_parent_folder_id", "string", "New parent folder ID", true)] },
      { name: "share_file", description: "Share a file with a user or make it public", params: [p("file_id", "string", "File ID", true), p("email", "string", "Email to share with"), p("role", "string", "Permission role")] },
      { name: "list_permissions", description: "List sharing permissions on a file", params: [p("file_id", "string", "File ID", true)] },
      { name: "export_file", description: "Export a file to a different format", params: [p("file_id", "string", "File ID", true), p("mime_type", "string", "Target MIME type", true)] },
    ],
  },
  {
    name: "filesystem",
    tools: [
      { name: "read_file", description: "Read the complete contents of a file", params: [p("path", "string", "File path", true)] },
      { name: "read_multiple_files", description: "Read the contents of multiple files at once", params: [p("paths", "array", "File paths", true)] },
      { name: "write_file", description: "Create a file or overwrite it with new content", params: [p("path", "string", "File path", true), p("content", "string", "File content", true)] },
      { name: "edit_file", description: "Make line-based edits to a text file", params: [p("path", "string", "File path", true), p("edits", "array", "List of edits to apply", true)] },
      { name: "create_directory", description: "Create a new directory, including parents if needed", params: [p("path", "string", "Directory path", true)] },
      { name: "list_directory", description: "List the contents of a directory", params: [p("path", "string", "Directory path", true)] },
      { name: "move_file", description: "Move or rename a file or directory", params: [p("source", "string", "Source path", true), p("destination", "string", "Destination path", true)] },
      { name: "search_files", description: "Recursively search for files matching a pattern", params: [p("path", "string", "Root path to search", true), p("pattern", "string", "Search pattern", true)] },
      { name: "get_file_info", description: "Get metadata about a file or directory", params: [p("path", "string", "File path", true)] },
      { name: "list_allowed_directories", description: "List directories this server is allowed to access", params: [] },
      { name: "directory_tree", description: "Get a recursive tree view of a directory", params: [p("path", "string", "Root path", true)] },
    ],
  },
  {
    name: "notion",
    tools: [
      { name: "search", description: "Search pages and databases by title", params: [p("query", "string", "Search query", true), p("filter_type", "string", "page or database")] },
      { name: "create_page", description: "Create a new page", params: [p("parent_id", "string", "Parent page or database ID", true), p("title", "string", "Page title", true), p("content", "string", "Page content")] },
      { name: "update_page", description: "Update a page's properties or archive it", params: [p("page_id", "string", "Page ID", true), p("archived", "boolean", "Whether to archive the page")] },
      { name: "get_page", description: "Get a page's content and properties", params: [p("page_id", "string", "Page ID", true)] },
      { name: "delete_page", description: "Move a page to trash", params: [p("page_id", "string", "Page ID", true)] },
      { name: "create_database", description: "Create a new database", params: [p("parent_id", "string", "Parent page ID", true), p("title", "string", "Database title", true), p("properties", "array", "Database property schema", true)] },
      { name: "query_database", description: "Query rows from a database with filters and sorts", params: [p("database_id", "string", "Database ID", true), p("filter", "string", "Filter expression"), p("sorts", "array", "Sort specifications")] },
      { name: "update_database", description: "Update a database's title or schema", params: [p("database_id", "string", "Database ID", true), p("title", "string", "New title")] },
      { name: "get_database", description: "Get a database's schema and metadata", params: [p("database_id", "string", "Database ID", true)] },
      { name: "append_block_children", description: "Append new blocks to a page or block", params: [p("block_id", "string", "Parent block or page ID", true), p("children", "array", "Blocks to append", true)] },
      { name: "get_block_children", description: "Get the child blocks of a block or page", params: [p("block_id", "string", "Block or page ID", true)] },
      { name: "update_block", description: "Update the content of a block", params: [p("block_id", "string", "Block ID", true), p("content", "string", "New content", true)] },
      { name: "delete_block", description: "Delete a block", params: [p("block_id", "string", "Block ID", true)] },
      { name: "create_comment", description: "Add a comment to a page or discussion", params: [p("parent_id", "string", "Page or discussion ID", true), p("text", "string", "Comment text", true)] },
    ],
  },
];
