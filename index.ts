#!/usr/bin/env bun
// slack_search.ts
//
// Usage:
//   SLACK_USER_TOKEN=xoxp-... npx tsx slack_search.ts --query "What did Jennifer say last week about Q1 goals?"
//   SLACK_USER_TOKEN=xoxp-... npx tsx slack_search.ts --query "project alpha OR project beta" --limit 10 --json
//   SLACK_USER_TOKEN=xoxp-... npx tsx slack_search.ts --query "project gizmo" --thread-channel C123 --thread-ts 1712345678.123456
//
// Optional when using bot token for assistant.search.context:
//   SLACK_TOKEN=xoxb-... SLACK_ACTION_TOKEN=... npx tsx slack_search.ts --query "..."
//
// Install:
//   npm install @slack/web-api
//   npm install -D tsx typescript

import { ErrorCode, WebClient } from "@slack/web-api";

type ContentType = "messages" | "files" | "channels" | "users";
type ChannelType = "public_channel" | "private_channel" | "mpim" | "im";
type SortDir = "asc" | "desc";

type ContextMessage = {
	text?: string;
	user_id?: string;
	author_name?: string;
	ts?: string;
};

type SearchMessage = {
	author_name?: string;
	author_user_id?: string;
	team_id?: string;
	channel_id?: string;
	channel_name?: string;
	message_ts?: string;
	thread_ts?: string;
	content?: string;
	permalink?: string;
	is_author_bot?: boolean;
	context_messages?: {
		before?: ContextMessage[];
		after?: ContextMessage[];
	};
};

type SearchFile = {
	file_id?: string;
	title?: string;
	file_type?: string;
	permalink?: string;
	content?: string;
	author_name?: string;
	uploader_user_id?: string;
	date_created?: number;
	date_updated?: number;
};

type SearchChannel = {
	team_id?: string;
	name?: string;
	topic?: string;
	purpose?: string;
	permalink?: string;
	creator_name?: string;
	date_created?: number;
	date_updated?: number;
};

type SearchUser = {
	user_id?: string;
	real_name?: string;
	display_name?: string;
	title?: string;
	permalink?: string;
};

type SearchContextResponse = {
	ok: boolean;
	results?: {
		messages?: SearchMessage[];
		files?: SearchFile[];
		channels?: SearchChannel[];
		users?: SearchUser[];
	};
	response_metadata?: {
		next_cursor?: string;
	};
	error?: string;
};

type SearchInfoResponse = {
	ok: boolean;
	is_ai_search_enabled?: boolean;
	error?: string;
};

type ThreadMessage = {
	type?: string;
	user?: string;
	text?: string;
	ts?: string;
	thread_ts?: string;
};

type ThreadResponse = {
	ok: boolean;
	messages?: ThreadMessage[];
	has_more?: boolean;
	response_metadata?: { next_cursor?: string };
	error?: string;
};

type Args = {
	query: string;
	limit: number;
	cursor?: string;
	contentTypes: ContentType[];
	channelTypes: ChannelType[];
	includeContextMessages: boolean;
	includeBots: boolean;
	includeMessageBlocks: boolean;
	before?: number;
	after?: number;
	sort?: "timestamp" | "relevance";
	sortDir?: SortDir;
	json: boolean;
	threadChannel?: string;
	threadTs?: string;
	threadLimit: number;
};

function parseArgs(argv: string[]): Args {
	const out: Args = {
		query: "",
		limit: 5,
		contentTypes: ["messages"],
		channelTypes: ["public_channel", "private_channel", "mpim", "im"],
		includeContextMessages: true,
		includeBots: false,
		includeMessageBlocks: false,
		json: false,
		threadLimit: 50,
	};

	const nextValue = (i: number): string => {
		const value = argv[i + 1];
		if (!value || value.startsWith("--")) {
			throw new Error(`Missing value for ${argv[i]}`);
		}
		return value;
	};

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--query":
			case "-q":
				out.query = nextValue(i);
				i++;
				break;
			case "--limit":
				out.limit = Number(nextValue(i));
				i++;
				break;
			case "--cursor":
				out.cursor = nextValue(i);
				i++;
				break;
			case "--content-types":
				out.contentTypes = nextValue(i)
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean) as ContentType[];
				i++;
				break;
			case "--channel-types":
				out.channelTypes = nextValue(i)
					.split(",")
					.map((s) => s.trim())
					.filter(Boolean) as ChannelType[];
				i++;
				break;
			case "--before":
				out.before = parseTimeArg(nextValue(i));
				i++;
				break;
			case "--after":
				out.after = parseTimeArg(nextValue(i));
				i++;
				break;
			case "--sort":
				out.sort = nextValue(i) as "timestamp" | "relevance";
				i++;
				break;
			case "--sort-dir":
				out.sortDir = nextValue(i) as SortDir;
				i++;
				break;
			case "--include-context":
				out.includeContextMessages = parseBool(nextValue(i));
				i++;
				break;
			case "--include-bots":
				out.includeBots = parseBool(nextValue(i));
				i++;
				break;
			case "--include-message-blocks":
				out.includeMessageBlocks = parseBool(nextValue(i));
				i++;
				break;
			case "--json":
				out.json = true;
				break;
			case "--thread-channel":
				out.threadChannel = nextValue(i);
				i++;
				break;
			case "--thread-ts":
				out.threadTs = nextValue(i);
				i++;
				break;
			case "--thread-limit":
				out.threadLimit = Number(nextValue(i));
				i++;
				break;
			case "--help":
			case "-h":
				printHelpAndExit(0);
				break;
			default:
				throw new Error(`Unknown argument: ${a}`);
		}
	}

	if (!out.query) {
		throw new Error("--query is required");
	}
	if (!Number.isFinite(out.limit) || out.limit < 1 || out.limit > 20) {
		throw new Error("--limit must be between 1 and 20");
	}
	if (
		!Number.isFinite(out.threadLimit) ||
		out.threadLimit < 1 ||
		out.threadLimit > 1000
	) {
		throw new Error("--thread-limit must be between 1 and 1000");
	}

	return out;
}

function parseBool(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
	throw new Error(`Invalid boolean: ${value}`);
}

function parseTimeArg(value: string): number {
	if (/^\d+$/.test(value)) {
		return Number(value);
	}
	const ms = Date.parse(value);
	if (Number.isNaN(ms)) {
		throw new Error(
			`Invalid time value: ${value}. Use unix seconds or ISO date.`,
		);
	}
	return Math.floor(ms / 1000);
}

function printHelpAndExit(code: number): never {
	const text = `
slack_search.ts

Required:
  --query, -q                Search query

Optional:
  --limit                    Search results per page (1-20, default: 5)
  --cursor                   Cursor for next page
  --content-types            messages,files,channels,users (default: messages)
  --channel-types            public_channel,private_channel,mpim,im
                             (default: public_channel,private_channel,mpim,im)
  --before                   Unix seconds or ISO date/time
  --after                    Unix seconds or ISO date/time
  --sort                     relevance | timestamp
  --sort-dir                 asc | desc
  --include-context          true|false (default: true)
  --include-bots             true|false (default: false)
  --include-message-blocks   true|false (default: false)
  --json                     Print raw-ish JSON output
  --thread-channel           Channel ID for explicit thread fetch
  --thread-ts                Root thread ts for explicit thread fetch
  --thread-limit             Thread messages to fetch (default: 50)

Environment:
  SLACK_USER_TOKEN           Preferred outside Slack client (xoxp-...)
  SLACK_TOKEN                Alternative token env var
  SLACK_ACTION_TOKEN         Required only when using bot token (xoxb-...) with assistant.search.context

Examples:
  SLACK_USER_TOKEN=xoxp-... npx tsx slack_search.ts --query "What is the status of project koho?"
  SLACK_USER_TOKEN=xoxp-... npx tsx slack_search.ts --query "budget OR finance OR expenses" --limit 10 --json
  SLACK_USER_TOKEN=xoxp-... npx tsx slack_search.ts --query "roadmap" --thread-channel C123456 --thread-ts 1712345678.123456
`.trim();

	console.log(text);
	process.exit(code);
}

function getToken(): string {
	const token = process.env.SLACK_USER_TOKEN || process.env.SLACK_TOKEN;
	if (!token) {
		throw new Error("Missing SLACK_USER_TOKEN or SLACK_TOKEN");
	}
	return token;
}

function isBotToken(token: string): boolean {
	return token.startsWith("xoxb-");
}

function requiredActionToken(token: string): string | undefined {
	if (!isBotToken(token)) return undefined;
	const actionToken = process.env.SLACK_ACTION_TOKEN;
	if (!actionToken) {
		throw new Error(
			"Bot token detected. Set SLACK_ACTION_TOKEN for assistant.search.context, or use a user token (SLACK_USER_TOKEN=xoxp-...)",
		);
	}
	return actionToken;
}

function slackDate(ts?: string | number): string {
	if (ts === undefined) return "";
	const n = typeof ts === "number" ? ts : Number(ts.split(".")[0]);
	if (!Number.isFinite(n)) return String(ts);
	return new Date(n * 1000).toISOString();
}

function indent(text: string, spaces = 2): string {
	const pad = " ".repeat(spaces);
	return text
		.split("\n")
		.map((line) => pad + line)
		.join("\n");
}

function truncate(s: string | undefined, max = 280): string {
	if (!s) return "";
	const oneLine = s.replace(/\s+/g, " ").trim();
	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

async function callSearchInfo(
	web: WebClient,
): Promise<SearchInfoResponse | null> {
	try {
		const resp = (await web.apiCall(
			"assistant.search.info",
		)) as SearchInfoResponse;
		return resp;
	} catch {
		// Search info is nice-to-have. Do not fail the whole script.
		return null;
	}
}

async function callSearchContext(
	web: WebClient,
	token: string,
	args: Args,
): Promise<SearchContextResponse> {
	const actionToken = requiredActionToken(token);

	const payload: Record<string, unknown> = {
		query: args.query,
		limit: args.limit,
		content_types: args.contentTypes,
		channel_types: args.channelTypes,
		include_context_messages: args.includeContextMessages,
		include_bots: args.includeBots,
		include_message_blocks: args.includeMessageBlocks,
	};

	if (args.cursor) payload.cursor = args.cursor;
	if (args.before !== undefined) payload.before = args.before;
	if (args.after !== undefined) payload.after = args.after;
	if (args.sort) payload.sort = args.sort;
	if (args.sortDir) payload.sort_dir = args.sortDir;
	if (actionToken) payload.action_token = actionToken;

	const resp = (await web.apiCall(
		"assistant.search.context",
		payload,
	)) as SearchContextResponse;
	if (!resp.ok) {
		throw new Error(
			`assistant.search.context failed: ${resp.error ?? "unknown_error"}`,
		);
	}
	return resp;
}

async function fetchThread(
	web: WebClient,
	channel: string,
	ts: string,
	limit: number,
): Promise<ThreadResponse> {
	const resp = (await web.conversations.replies({
		channel,
		ts,
		limit,
		inclusive: true,
	})) as ThreadResponse;

	if (!resp.ok) {
		throw new Error(
			`conversations.replies failed: ${resp.error ?? "unknown_error"}`,
		);
	}
	return resp;
}

function printPretty(
	searchInfo: SearchInfoResponse | null,
	searchResp: SearchContextResponse,
	threadResp: ThreadResponse | null,
): void {
	console.log("=== Slack Search ===");
	if (searchInfo?.ok) {
		console.log(
			`AI search enabled: ${String(searchInfo.is_ai_search_enabled)}`,
		);
	}

	const messages = searchResp.results?.messages ?? [];
	const files = searchResp.results?.files ?? [];
	const channels = searchResp.results?.channels ?? [];
	const users = searchResp.results?.users ?? [];
	const nextCursor = searchResp.response_metadata?.next_cursor ?? "";

	console.log(`Messages: ${messages.length}`);
	console.log(`Files: ${files.length}`);
	console.log(`Channels: ${channels.length}`);
	console.log(`Users: ${users.length}`);
	console.log(`Next cursor: ${nextCursor || "(none)"}`);
	console.log("");

	if (messages.length) {
		console.log("=== Messages ===");
		for (const [idx, m] of messages.entries()) {
			console.log(`#${idx + 1}`);
			console.log(`author     : ${m.author_name ?? "-"}`);
			console.log(`channel    : ${m.channel_name ?? m.channel_id ?? "-"}`);
			console.log(
				`ts         : ${m.message_ts ?? "-"} (${slackDate(m.message_ts)})`,
			);
			console.log(`permalink  : ${m.permalink ?? "-"}`);
			console.log(`bot        : ${String(m.is_author_bot ?? false)}`);
			console.log(`content    : ${truncate(m.content, 500) || "-"}`);

			const before = m.context_messages?.before ?? [];
			const after = m.context_messages?.after ?? [];
			if (before.length || after.length) {
				console.log("context:");
				if (before.length) {
					console.log("  before:");
					for (const c of before) {
						console.log(
							indent(
								`- [${slackDate(c.ts)}] ${c.author_name ?? c.user_id ?? "unknown"}: ${truncate(c.text, 240)}`,
								4,
							),
						);
					}
				}
				if (after.length) {
					console.log("  after:");
					for (const c of after) {
						console.log(
							indent(
								`- [${slackDate(c.ts)}] ${c.author_name ?? c.user_id ?? "unknown"}: ${truncate(c.text, 240)}`,
								4,
							),
						);
					}
				}
			}
			console.log("");
		}
	}

	if (files.length) {
		console.log("=== Files ===");
		for (const [idx, f] of files.entries()) {
			console.log(`#${idx + 1}`);
			console.log(`title      : ${f.title ?? "-"}`);
			console.log(`type       : ${f.file_type ?? "-"}`);
			console.log(`author     : ${f.author_name ?? "-"}`);
			console.log(`permalink  : ${f.permalink ?? "-"}`);
			console.log(`content    : ${truncate(f.content, 300) || "-"}`);
			console.log("");
		}
	}

	if (channels.length) {
		console.log("=== Channels ===");
		for (const [idx, c] of channels.entries()) {
			console.log(`#${idx + 1}`);
			console.log(`name       : ${c.name ?? "-"}`);
			console.log(`topic      : ${truncate(c.topic, 300) || "-"}`);
			console.log(`purpose    : ${truncate(c.purpose, 300) || "-"}`);
			console.log(`permalink  : ${c.permalink ?? "-"}`);
			console.log("");
		}
	}

	if (users.length) {
		console.log("=== Users ===");
		for (const [idx, u] of users.entries()) {
			console.log(`#${idx + 1}`);
			console.log(`real_name  : ${u.real_name ?? "-"}`);
			console.log(`display    : ${u.display_name ?? "-"}`);
			console.log(`title      : ${u.title ?? "-"}`);
			console.log(`permalink  : ${u.permalink ?? "-"}`);
			console.log("");
		}
	}

	if (threadResp?.messages?.length) {
		console.log("=== Thread ===");
		for (const [idx, m] of threadResp.messages.entries()) {
			console.log(
				`#${idx + 1} [${slackDate(m.ts)}] ${m.user ?? "unknown"}: ${truncate(m.text, 500) || "-"}`,
			);
		}
		console.log("");
	}
}

function printJson(
	searchInfo: SearchInfoResponse | null,
	searchResp: SearchContextResponse,
	threadResp: ThreadResponse | null,
): void {
	console.log(
		JSON.stringify(
			{
				search_info: searchInfo,
				search: searchResp,
				thread: threadResp,
			},
			null,
			2,
		),
	);
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	const token = getToken();
	const web = new WebClient(token);

	const searchInfo = await callSearchInfo(web);
	const searchResp = await callSearchContext(web, token, args);

	let threadResp: ThreadResponse | null = null;
	if (args.threadChannel && args.threadTs) {
		threadResp = await fetchThread(
			web,
			args.threadChannel,
			args.threadTs,
			args.threadLimit,
		);
	}

	if (args.json) {
		printJson(searchInfo, searchResp, threadResp);
	} else {
		printPretty(searchInfo, searchResp, threadResp);
	}
}

// ─── OAuth auth command ──────────────────────────────────────────────────────

type OAuthV2AccessResponse = {
	ok: boolean;
	authed_user?: {
		access_token?: string;
	};
	error?: string;
};

async function exchangeCode(
	clientId: string,
	clientSecret: string,
	code: string,
	redirectUri: string,
): Promise<string> {
	const resp = await fetch("https://slack.com/api/oauth.v2.access", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
			redirect_uri: redirectUri,
		}),
	});

	const data = (await resp.json()) as OAuthV2AccessResponse;
	if (!data.ok || !data.authed_user?.access_token) {
		throw new Error(`Token exchange failed: ${data.error ?? "unknown_error"}`);
	}
	return data.authed_user.access_token;
}

async function runAuth(manual: boolean): Promise<void> {
	const clientId = process.env.SLACK_CLIENT_ID;
	const clientSecret = process.env.SLACK_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		throw new Error("SLACK_CLIENT_ID and SLACK_CLIENT_SECRET must be set");
	}

	const userScopes = [
		"search:read",
		"search:read.public",
		"channels:history",
		"channels:read",
		"groups:history",
		"groups:read",
		"im:history",
		"im:read",
		"mpim:history",
		"mpim:read",
	].join(",");

	// State token for CSRF protection
	const state = crypto.randomUUID();

	if (manual) {
		// --manual: no local server.
		// Register https://localhost/callback in Slack App Redirect URLs,
		// then paste the redirect URL from the browser address bar.
		const redirectUri = "https://localhost/callback";

		const authUrl = new URL("https://slack.com/oauth/v2/authorize");
		authUrl.searchParams.set("client_id", clientId);
		authUrl.searchParams.set("user_scope", userScopes);
		authUrl.searchParams.set("redirect_uri", redirectUri);
		authUrl.searchParams.set("state", state);

		console.log("1. Slack App の Redirect URLs に以下を登録してください:");
		console.log(`   ${redirectUri}\n`);
		console.log("2. 以下のURLをブラウザで開いて認証してください:");
		console.log(`   ${authUrl.toString()}\n`);
		console.log("3. 認証後にブラウザが接続エラーを表示します。");
		console.log(
			"   アドレスバーの URL (https://localhost/callback?code=...) をコピーして貼り付けてください:",
		);

		const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
		await Bun.$`${openCmd} ${authUrl.toString()}`.quiet().nothrow();

		const line = await new Promise<string>((resolve) => {
			process.stdin.once("data", (buf) => resolve(buf.toString().trim()));
		});

		let code: string | null = null;
		let returnedState: string | null = null;
		try {
			const pasted = new URL(line);
			code = pasted.searchParams.get("code");
			returnedState = pasted.searchParams.get("state");
		} catch {
			// User pasted only the code value
			code = line;
		}

		if (returnedState && returnedState !== state) {
			throw new Error("State mismatch (CSRF protection)");
		}
		if (!code) {
			throw new Error("No code found in pasted value");
		}

		const token = await exchangeCode(clientId, clientSecret, code, redirectUri);
		console.log(`\nSLACK_USER_TOKEN=${token}`);
	} else {
		// Default: start local HTTP server on localhost:3000
		const port = 3000;
		const redirectUri = `http://localhost:${port}/callback`;

		const authUrl = new URL("https://slack.com/oauth/v2/authorize");
		authUrl.searchParams.set("client_id", clientId);
		authUrl.searchParams.set("user_scope", userScopes);
		authUrl.searchParams.set("redirect_uri", redirectUri);
		authUrl.searchParams.set("state", state);

		let resolveToken!: (token: string) => void;
		let rejectToken!: (err: Error) => void;
		const tokenPromise = new Promise<string>((resolve, reject) => {
			resolveToken = resolve;
			rejectToken = reject;
		});

		const server = Bun.serve({
			port,
			fetch(req) {
				const url = new URL(req.url);
				if (url.pathname !== "/callback") {
					return new Response("Not found", { status: 404 });
				}

				const oauthError = url.searchParams.get("error");
				if (oauthError) {
					rejectToken(new Error(`OAuth error: ${oauthError}`));
					return new Response(`Error: ${oauthError}`, { status: 400 });
				}

				const returnedState = url.searchParams.get("state");
				if (returnedState !== state) {
					rejectToken(new Error("State mismatch (CSRF protection)"));
					return new Response("State mismatch", { status: 400 });
				}

				const code = url.searchParams.get("code");
				if (!code) {
					rejectToken(new Error("No code received"));
					return new Response("No code", { status: 400 });
				}

				exchangeCode(clientId, clientSecret, code, redirectUri)
					.then(resolveToken)
					.catch(rejectToken);

				return new Response(
					"<html><body><h1>認証完了!</h1><p>ターミナルでトークンを確認してください。このウィンドウは閉じて構いません。</p></body></html>",
					{ headers: { "content-type": "text/html; charset=utf-8" } },
				);
			},
		});

		console.log("Slack App の Redirect URLs に以下を登録してください:");
		console.log(`  ${redirectUri}\n`);
		console.log("ブラウザでSlackの認証ページを開きます...");
		console.log(`URL: ${authUrl.toString()}\n`);

		const openCmd = process.platform === "darwin" ? "open" : "xdg-open";
		await Bun.$`${openCmd} ${authUrl.toString()}`.quiet().nothrow();

		try {
			const token = await tokenPromise;
			console.log(`\nSLACK_USER_TOKEN=${token}`);
		} finally {
			server.stop();
		}
	}
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function run(): Promise<void> {
	const subcommand = process.argv[2];
	if (subcommand === "auth") {
		const manual = process.argv.includes("--manual");
		await runAuth(manual);
	} else {
		await main();
	}
}

run().catch((error: unknown) => {
	if (typeof error === "object" && error !== null && "code" in error) {
		const e = error as {
			code?: string;
			data?: unknown;
			retryAfter?: number;
			message?: string;
		};
		if (e.code === ErrorCode.PlatformError) {
			console.error("Slack platform error:");
			console.error(JSON.stringify(e.data, null, 2));
			process.exit(2);
		}
		if (e.code === ErrorCode.RateLimitedError) {
			console.error(
				`Slack rate limited. Retry after ${String(e.retryAfter ?? "?")} seconds.`,
			);
			process.exit(3);
		}
	}

	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "Unknown error";
	console.error(message);
	process.exit(1);
});
