---
title: AI agents (MCP)
description: Let an AI agent read what your app did in the database, through the profiler's MCP server.
---

The profiler is also an MCP server. An AI agent working on your app (Claude Code, Cursor, VS Code)
reads the same profiles you see in `/_profiler`: each request, each query with its line of code,
the plan, the index to add, the code that replaces an N+1. So it answers "why is `/orders` slow?"
or "fix the N+1s on this page" from what your app really did, not from a guess.

It is at `http://localhost:4983/_profiler/mcp`, on the profiler's own port: the
[preload](/docs/guides/node) opens it for a Node server, and the
[Vite plugin](/docs/guides/react-router) opens it for React Router. Nothing else to install or run:
when your dev server starts, the terminal says where it is.

```txt
[query-profiler] http://localhost:4983/_profiler · MCP: http://localhost:4983/_profiler/mcp
```

If you set `QUERY_PROFILER_PORT`, or the port was busy and it took the next one, use the port the
terminal prints.

## Connect your agent

**Claude Code:**

```sh
claude mcp add --transport http query-profiler http://localhost:4983/_profiler/mcp
```

**Cursor**, in `.cursor/mcp.json`:

```json
{ "mcpServers": { "query-profiler": { "url": "http://localhost:4983/_profiler/mcp" } } }
```

**VS Code**, in `.vscode/mcp.json`:

```json
{
  "servers": { "query-profiler": { "type": "http", "url": "http://localhost:4983/_profiler/mcp" } }
}
```

Any other client that speaks MCP over HTTP takes the same URL.

## What the agent can do

| Tool              | What it gives                                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_requests`   | The recent requests, scripts and tasks, newest first: what ran, its status, queries, time in the database, warnings. Filters by path, kind and warnings |
| `get_request`     | One whole: its warnings, its Prisma operations with their arguments, each query with its SQL, parameters, rows, time and line of code                   |
| `fix_n1`          | For each N+1, [the code that replaces the loop](/docs/concepts/warnings#fixing-an-n1), the line to change and the queries it saves                      |
| `explain_query`   | The [plan](/docs/concepts/query-analysis), the tables and their indexes, and the findings with their fixes, the `@@index` line included                 |
| `try_index`       | Creates a suggested index in a transaction that is rolled back, and asks the plan again: would the database use it?                                     |
| `analyze_session` | The indexes that fix the most across the stored requests, what the rules find, and the tables the time goes to                                          |
| `get_stats`       | The slowest and most repeated statements, by model and by route                                                                                         |

`explain_query` asks the database for an estimate: nothing runs. With `measure: true` it runs a
read in a transaction that is rolled back, as **Measure it** does in the page. `try_index` creates
the index the same way, and rolls it back. Every other tool only reads what the profiler already
has.

## What to ask

- "Look at the last request with warnings and fix its N+1."
- "Why is `/orders` slow? Check the plan of its slowest query."
- "Which indexes would help this app the most?"
- "Run the seed and tell me what it did in the database." (With the seed run through the preload,
  see [Scripts, workers and jobs](/docs/guides/scripts).)

## How it works

It runs inside the profiler, with the official SDK,
[`@modelcontextprotocol/server`](https://www.npmjs.com/package/@modelcontextprotocol/server). The
SDK loads only once an agent connects, never with your app. Each request gets a fresh server, with
no session to keep, for clients of the 2026-07-28 protocol and of 2025.

Like the rest of the [API](/docs/reference/http-api), it runs only in development and answers only
requests addressed to a local host. A request from a page of another site (an `Origin` that is not
local) is turned away, so a page in your browser cannot call it.

Profiles live in the dev server's memory: the agent sees the last 100, and nothing once the dev
server restarts.
