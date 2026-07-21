# Security Policy

## Supported versions

This project is pre-1.0 and moves quickly. Only the latest published version on
[npm](https://www.npmjs.com/package/@mcp-scout/mcp-scout) is supported — please upgrade before
reporting an issue to confirm it still reproduces.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a security vulnerability.

Instead, use GitHub's private vulnerability reporting: go to the
[Security tab](https://github.com/mcp-scout/mcp-scout/security) → **Report a vulnerability**. This
opens a private conversation with the maintainer, visible only to the two of you until a fix is
ready.

We'll acknowledge reports within a few days and aim to ship a fix or mitigation before any public
disclosure.

## Scope

mcp-scout is a proxy: it connects to the downstream MCP servers listed in your config and exposes
them through 4 meta-tools. In scope for this policy:

- Anything that lets a `call_tool` invocation bypass, spoof, or escalate beyond what the underlying
  downstream server itself would allow (e.g. namespace/argument confusion between servers).
- Anything that lets `search_tools`/`describe_tools` leak information from a server your config
  didn't actually grant access to.
- Crashes, hangs, or resource exhaustion triggerable by a malicious or malformed downstream response.

Out of scope: vulnerabilities in the downstream MCP servers themselves (report those to the
maintainers of that server), and issues that require the attacker to already control your local
config file (at that point they can just edit the config directly).
