---
name: slack-cli
description: "Use when: searching Slack messages, files, channels, or users from the command line; fetching thread replies; or obtaining a SLACK_USER_TOKEN via OAuth. Also use when the user asks questions like 'search Slack for X', 'find messages about Y in Slack', or 'get my Slack token'. Requires SLACK_USER_TOKEN environment variable. Uses the slack-cli tool built with Bun."
---

# Slack CLI

A CLI tool for searching Slack via `assistant.search.context` API. Source: https://github.com/mpppk/slack-cli

## Running

No installation needed — use `bunx`:

```bash
bunx github:mpppk/slack-cli --query "<query>" [options]
```

Or install globally once:

```bash
bun install -g github:mpppk/slack-cli
slack-cli --query "<query>" [options]
```

## Prerequisites

```bash
export SLACK_USER_TOKEN=xoxp-your_token_here
```

To obtain a token via OAuth, see the **Authentication** section below.

## Search Command

```bash
bunx github:mpppk/slack-cli --query "<query>" [options]
```

### Required

| Flag | Description |
|------|-------------|
| `--query`, `-q` | Search query string |

### Optional

| Flag | Default | Description |
|------|---------|-------------|
| `--limit` | `5` | Results per page (1–20) |
| `--cursor` | — | Cursor for next page (from previous output) |
| `--content-types` | `messages` | Comma-separated: `messages,files,channels,users` |
| `--channel-types` | all | Comma-separated: `public_channel,private_channel,mpim,im` |
| `--before` | — | Unix seconds or ISO date/time |
| `--after` | — | Unix seconds or ISO date/time |
| `--sort` | — | `relevance` \| `timestamp` |
| `--sort-dir` | — | `asc` \| `desc` |
| `--include-context` | `true` | Include surrounding messages |
| `--include-bots` | `false` | Include bot-authored messages |
| `--include-message-blocks` | `false` | Include block kit payloads |
| `--json` | — | Print raw JSON output |
| `--thread-channel` | — | Channel ID for explicit thread fetch |
| `--thread-ts` | — | Root thread timestamp for explicit thread fetch |
| `--thread-limit` | `50` | Max thread messages to fetch (1–1000) |

## Authentication

To obtain a `SLACK_USER_TOKEN` via OAuth, you need a Slack App with `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.

### Automatic mode (default)
Registers `http://localhost:3000/callback` in Slack App Redirect URLs, then starts a local server:

```bash
SLACK_CLIENT_ID=xxx SLACK_CLIENT_SECRET=yyy bunx github:mpppk/slack-cli auth
```

### Manual mode (HTTPS-only environments)
Registers `https://localhost/callback` in Slack App Redirect URLs, then paste the redirect URL from the browser:

```bash
SLACK_CLIENT_ID=xxx SLACK_CLIENT_SECRET=yyy bunx github:mpppk/slack-cli auth --manual
```

Both modes print `SLACK_USER_TOKEN=xoxp-...` on success.

## Common Workflows

### Search messages about a topic
```bash
SLACK_USER_TOKEN=xoxp-... bunx github:mpppk/slack-cli --query "プロジェクト計画"
```

### Search with date range
```bash
SLACK_USER_TOKEN=xoxp-... bunx github:mpppk/slack-cli --query "budget" --after 2024-01-01 --before 2024-03-31
```

### Search files only
```bash
SLACK_USER_TOKEN=xoxp-... bunx github:mpppk/slack-cli --query "roadmap" --content-types files
```

### Fetch a specific thread
```bash
SLACK_USER_TOKEN=xoxp-... bunx github:mpppk/slack-cli --query "dummy" --thread-channel C1234567890 --thread-ts 1712345678.123456
```

### Get raw JSON for programmatic use
```bash
SLACK_USER_TOKEN=xoxp-... bunx github:mpppk/slack-cli --query "budget" --json
```

### Paginate results
```bash
# First page
SLACK_USER_TOKEN=xoxp-... bunx github:mpppk/slack-cli --query "budget" --limit 10

# Next page (use cursor from previous output)
SLACK_USER_TOKEN=xoxp-... bunx github:mpppk/slack-cli --query "budget" --limit 10 --cursor <cursor>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_USER_TOKEN` | User token (xoxp-...) — preferred |
| `SLACK_TOKEN` | Alternative token env var |
| `SLACK_ACTION_TOKEN` | Required only when using a bot token (xoxb-...) |
| `SLACK_CLIENT_ID` | Slack App Client ID (for `auth` command) |
| `SLACK_CLIENT_SECRET` | Slack App Client Secret (for `auth` command) |

## Key Notes

- `assistant.search.context` requires `search:read` and `search:read.public` scopes
- The `auth` command requests all necessary scopes automatically
- `--json` output includes `search_info`, `search` results, and optional `thread` replies
- Cursor-based pagination: use `response_metadata.next_cursor` from JSON output for `--cursor`
