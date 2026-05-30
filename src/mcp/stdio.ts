import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Scope } from "../auth/apikey.js";
import { EventBus } from "../core/event-bus.js";
import { openDb } from "../db/connection.js";
import { createServices } from "../services/container.js";
import { startChangeRelay } from "./relay.js";
import { buildMcpServer } from "./server.js";

// Load .env (DB_PATH, MCP_AUTH, YOT_API_KEY) if present. Real env vars win.
// NOTE: stdout is the JSON-RPC channel for stdio MCP, so this entry point must
// never write to it — all diagnostics go to stderr (console.error).
try {
	process.loadEnvFile();
} catch {
	// No .env file — rely on the ambient environment.
}

const DB_PATH = process.env.DB_PATH ?? "data.db";
// MCP auth is on by default; set MCP_AUTH=off (or false/0/no) to skip the key
// lookup and run with full write scope. Unlike the HTTP server there is no
// per-request header here: scope is derived once from YOT_API_KEY at startup.
const MCP_AUTH_DISABLED = ["off", "false", "0", "no"].includes(
	(process.env.MCP_AUTH ?? "on").toLowerCase(),
);

const db = openDb(DB_PATH);
const bus = new EventBus();
const services = createServices(db, bus);

let scope: Scope;
if (MCP_AUTH_DISABLED) {
	scope = "write";
} else {
	const raw = process.env.YOT_API_KEY?.trim();
	if (!raw) {
		console.error(
			"YOT_API_KEY is not set (looked in .env and the environment). " +
				"Set it to a valid key, or run with MCP_AUTH=off to disable auth.",
		);
		process.exit(1);
	}
	const key = services.apiKeys.findByRawKey(raw);
	if (!key) {
		console.error("YOT_API_KEY is invalid or revoked.");
		process.exit(1);
	}
	services.apiKeys.touch(key.id);
	scope = key.scope;
}

const server = buildMcpServer(services, scope);
const transport = new StdioServerTransport();
await server.connect(transport);

// --- SSE relay: forward MCP bus events to the HTTP server ---
const RELAY_DISABLED = ["off", "false", "0", "no"].includes(
	(process.env.YOT_SSE_RELAY ?? "on").toLowerCase(),
);
const relayKey = process.env.YOT_API_KEY?.trim();
if (!RELAY_DISABLED && relayKey) {
	const port = process.env.PORT ?? "4010";
	const base = process.env.YOT_HTTP_URL ?? `http://127.0.0.1:${port}`;
	const url = `${base.replace(/\/$/, "")}/api/internal/events`;
	startChangeRelay(bus, { url, apiKey: relayKey });
	console.error(`[relay] forwarding changes to ${url}`);
} else {
	console.error("[relay] disabled (no key or YOT_SSE_RELAY=off)");
}
