import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
	confirm,
	intro,
	isCancel,
	note,
	outro,
	select,
	text,
} from "@clack/prompts";
import { ApiKeyService } from "../src/auth/apikey.js";
import { openDb } from "../src/db/connection.js";

try {
	process.loadEnvFile();
} catch {}
const DB_PATH = process.env.DB_PATH ?? "data.db";

function cancelled(): never {
	outro("Cancelled.");
	process.exit(0);
}

function updateEnvFile(envPath: string, updates: Record<string, string>): void {
	let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
	for (const [key, value] of Object.entries(updates)) {
		const line = `${key}=${value}`;
		if (new RegExp(`^${key}=`, "m").test(content)) {
			content = content.replace(new RegExp(`^${key}=.*$`, "m"), line);
		} else {
			content +=
				(content === "" || content.endsWith("\n") ? "" : "\n") + line + "\n";
		}
	}
	writeFileSync(envPath, content, "utf8");
}

async function main() {
	intro("Calendar backend — create an API key");

	// openDb also applies the schema, so this initializes a fresh database too.
	const apiKeys = new ApiKeyService(openDb(DB_PATH));

	const name = await text({
		message: "Label for this key",
		placeholder: "cli, mobile, ...",
		defaultValue: "default",
	});
	if (isCancel(name)) cancelled();

	const scope = await select({
		message: "Scope",
		options: [
			{ value: "write", label: "write — full read/write access" },
			{ value: "read", label: "read — read-only access" },
		],
	});
	if (isCancel(scope)) cancelled();

	const envPathInput = await text({
		message: "Save API key to .env file",
		placeholder: ".env",
		defaultValue: ".env",
	});
	if (isCancel(envPathInput)) cancelled();
	const rawEnvPath = String(envPathInput) || ".env";
	const envPath = resolve(rawEnvPath.replace(/^~(?=[/\\]|$)/, homedir()));

	const mcpAuth = await select({
		message: "MCP authentication",
		options: [
			{
				value: "on",
				label: "on (recommended) — require YOT_API_KEY for the MCP server",
			},
			{ value: "off", label: "off — MCP server runs with full write, no key" },
		],
	});
	if (isCancel(mcpAuth)) cancelled();

	// If they turned off auth, throw the scary warning and force a manual confirm
	if (mcpAuth === "off") {
		note(
			"⚠️  CRITICAL SECURITY EXPOSURE WARNING  ⚠️\n\n" +
				"🔴 Setting MCP_AUTH to 'off' makes the MCP server run every tool with\n" +
				"full WRITE scope and no key check.\n\n" +
				"ANYONE who can launch this server can read, modify, or MALICIOUSLY\n" +
				"WIPE your database. Never use this configuration in production.",
			"🚨 DANGER: SECURITY COMPLETELY DISABLED 🚨",
		);

		const acknowledge = await confirm({
			message:
				"Do you explicitly understand the risks and wish to proceed anyway?",
			active: "Yes, I accept the risk",
			inactive: "No, abort immediately",
			initialValue: false,
		});

		if (isCancel(acknowledge) || !acknowledge) {
			cancelled();
		}
	}

	const { raw } = apiKeys.create(
		String(name) || null,
		scope as "read" | "write",
	);

	const envUpdates: Record<string, string> = { YOT_API_KEY: raw };
	if (mcpAuth === "off") envUpdates.MCP_AUTH = "off";
	updateEnvFile(envPath, envUpdates);

	note(raw, "Your API key (shown once — store it now)");

	outro(
		`Key saved to ${envPath}  ·  Header:  Authorization: Bearer ${raw.slice(0, 12)}…`,
	);
}

await main();
