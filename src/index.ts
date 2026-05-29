import { StreamableHTTPTransport } from "@hono/mcp";
import { serve } from "@hono/node-server";
import { authenticate } from "./auth/middleware.js";
import { EventBus } from "./core/event-bus.js";
import { openDb } from "./db/connection.js";
import { buildMcpServer } from "./mcp/server.js";
import { buildApp } from "./rest/app.js";
import { createServices } from "./services/container.js";
import { INDEX_HTML } from "./web/page.js";

// Load .env (PORT, DB_PATH, MCP_AUTH, ...) if present. Real env vars win.
try {
	process.loadEnvFile();
} catch {
	// No .env file — rely on the ambient environment.
}

const DB_PATH = process.env.DB_PATH ?? "data.db";
const PORT = Number(process.env.PORT ?? 3000);
// MCP auth is on by default; set MCP_AUTH=off (or false/0/no) to open /mcp for
// streamable-HTTP clients that can't send an Authorization header.
const MCP_AUTH_DISABLED = ["off", "false", "0", "no"].includes(
	(process.env.MCP_AUTH ?? "on").toLowerCase(),
);

const db = openDb(DB_PATH);
const bus = new EventBus();
const services = createServices(db, bus);

const app = buildApp({ bus, services, logging: true });

// Minimal web console for poking the REST API (public, same-origin).
app.get("/", (c) => c.html(INDEX_HTML));

// MCP endpoint: authenticated like the REST API unless MCP_AUTH is disabled. A
// per-request server is built with the authenticated key's scope so write tools
// refuse read-only keys; when auth is off it runs with full write scope.
if (!MCP_AUTH_DISABLED) {
	app.use("/mcp", authenticate(services.apiKeys));
}
app.all("/mcp", async (c) => {
	const scope = MCP_AUTH_DISABLED ? "write" : c.get("apiKey").scope;
	const server = buildMcpServer(services, scope);
	const transport = new StreamableHTTPTransport();
	await server.connect(transport);
	return (await transport.handleRequest(c)) ?? c.body(null, 204);
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`Calendar backend listening on http://localhost:${info.port}`);
	console.log(`  REST   http://localhost:${info.port}/api`);
	console.log(`  Docs   http://localhost:${info.port}/api/ui`);
	console.log(`  SSE    http://localhost:${info.port}/api/stream`);
	console.log(
		`  MCP    http://localhost:${info.port}/mcp  (auth: ${MCP_AUTH_DISABLED ? "OFF" : "on"})`,
	);
});
