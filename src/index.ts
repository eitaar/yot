import { serve } from "@hono/node-server";
import { EventBus } from "./core/event-bus.js";
import { openDb } from "./db/connection.js";
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
const PORT = Number(process.env.PORT ?? 4010);

const db = openDb(DB_PATH);
const bus = new EventBus();
const services = createServices(db, bus);

const app = buildApp({ bus, services, logging: true });

// Minimal web console for poking the REST API (public, same-origin).
app.get("/", (c) => c.html(INDEX_HTML));

serve({ fetch: app.fetch, port: PORT }, (info) => {
	console.log(`Calendar backend listening on http://localhost:${info.port}`);
	console.log(`  REST   http://localhost:${info.port}/api`);
	console.log(`  Docs   http://localhost:${info.port}/api/ui`);
	console.log(`  SSE    http://localhost:${info.port}/api/stream`);
});
