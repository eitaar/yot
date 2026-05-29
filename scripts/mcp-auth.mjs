// Emits MCP connection headers for the `yot` server, reading the API key from
// .env so the secret never lives in the committed .mcp.json.
//
// Wired up via `headersHelper` in .mcp.json. Claude Code runs this at connect
// time and merges the JSON printed to stdout into the request headers.
// Output: {"Authorization":"Bearer <key>"}
import { join } from "node:path";

try {
	// Resolve .env relative to this script so it works regardless of cwd.
	process.loadEnvFile(join(import.meta.dirname, "..", ".env"));
} catch {
	// No .env file — fall back to an already-present environment variable.
}

const key = process.env.YOT_API_KEY;
if (!key) {
	console.error("YOT_API_KEY is not set (looked in .env and the environment).");
	process.exit(1);
}

process.stdout.write(JSON.stringify({ Authorization: `Bearer ${key}` }));
