import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
import { type ApiKey, ApiKeyService } from "../src/auth/apikey.js";
import { openDb } from "../src/db/connection.js";

const envPath = resolve(process.argv[2] ?? ".env");

try {
	process.loadEnvFile(envPath);
} catch {}

function cancelled(): never {
	outro("Cancelled.");
	process.exit(0);
}

function updateEnvFile(path: string, updates: Record<string, string>): void {
	let content = existsSync(path) ? readFileSync(path, "utf8") : "";
	for (const [key, value] of Object.entries(updates)) {
		const line = `${key}=${value}`;
		if (new RegExp(`^${key}=`, "m").test(content)) {
			content = content.replace(new RegExp(`^${key}=.*$`, "m"), line);
		} else {
			content += `${content === "" || content.endsWith("\n") ? "" : "\n"}${line}\n`;
		}
	}
	writeFileSync(path, content, "utf8");
}

function getCurrentValues() {
	return {
		PORT: process.env.PORT ?? "4010",
		DB_PATH: process.env.DB_PATH ?? "data.db",
		MCP_AUTH: process.env.MCP_AUTH ?? "on",
	};
}

function formatValues(v: ReturnType<typeof getCurrentValues>) {
	return `PORT     ${v.PORT}\nDB_PATH  ${v.DB_PATH}\nMCP_AUTH ${v.MCP_AUTH}`;
}

function formatKeys(keys: ApiKey[]): string {
	if (keys.length === 0) return "No API keys yet.";
	return keys
		.map((k) => {
			const id = k.id.slice(0, 8);
			const label = k.name ?? "(unnamed)";
			const state = k.revoked ? "REVOKED" : "active";
			const used = k.last_used_at ?? "never";
			return `${id}  ${label}  [${k.scope}]  ${state}\n   created ${k.created_at}  ·  last used ${used}`;
		})
		.join("\n");
}

/** List / create / revoke API keys, reusing the backend ApiKeyService. */
async function manageApiKeys(): Promise<void> {
	// openDb applies the schema, so this also initializes a fresh database.
	const db = openDb(process.env.DB_PATH ?? "data.db");
	const apiKeys = new ApiKeyService(db);
	try {
		while (true) {
			const action = await select({
				message: "API keys",
				options: [
					{ value: "list", label: "List keys" },
					{ value: "create", label: "Create key" },
					{ value: "revoke", label: "Revoke key" },
					{ value: "back", label: "Back" },
				],
			});
			if (isCancel(action)) cancelled();
			if (action === "back") return;

			if (action === "list") {
				note(formatKeys(apiKeys.list()), "API keys");
			} else if (action === "create") {
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

				const { raw } = apiKeys.create(
					String(name) || null,
					scope as "read" | "write",
				);
				process.env.YOT_API_KEY = raw;
				updateEnvFile(envPath, { YOT_API_KEY: raw });
				note(raw, "Your API key (shown once — store it now)");
			} else if (action === "revoke") {
				const active = apiKeys.list().filter((k) => !k.revoked);
				if (active.length === 0) {
					note("No active keys to revoke.", "API keys");
					continue;
				}
				const id = await select({
					message: "Revoke which key?",
					options: active.map((k) => ({
						value: k.id,
						label: `${k.name ?? "(unnamed)"} · ${k.id.slice(0, 8)} · ${k.scope}`,
					})),
				});
				if (isCancel(id)) cancelled();

				const ok = await confirm({
					message: "Revoke this key? Clients using it will stop working.",
					initialValue: false,
				});
				if (isCancel(ok)) cancelled();
				if (ok) {
					apiKeys.revoke(String(id));
					note("Key revoked.", "API keys");
				}
			}
		}
	} finally {
		db.close();
	}
}

async function main() {
	intro("Calendar backend — configuration");
	note(formatValues(getCurrentValues()), `Current config  (${envPath})`);

	while (true) {
		const setting = await select({
			message: "Edit a setting",
			options: [
				{ value: "PORT", label: "PORT — HTTP listen port" },
				{ value: "DB_PATH", label: "DB_PATH — SQLite database file path" },
				{
					value: "MCP_AUTH",
					label: "MCP_AUTH — require YOT_API_KEY for the MCP server",
				},
				{ value: "API_KEYS", label: "API keys — list / create / revoke" },
				{ value: "done", label: "Done" },
			],
		});
		if (isCancel(setting)) cancelled();
		if (setting === "done") break;
		if (setting === "API_KEYS") {
			await manageApiKeys();
			continue;
		}

		if (setting === "PORT") {
			const val = await text({
				message: "PORT",
				defaultValue: getCurrentValues().PORT,
				validate: (v) => {
					const n = Number(v);
					if (!Number.isInteger(n) || n < 1 || n > 65535)
						return "Must be an integer 1–65535";
				},
			});
			if (isCancel(val)) cancelled();
			process.env.PORT = String(val);
			updateEnvFile(envPath, { PORT: String(val) });
		} else if (setting === "DB_PATH") {
			const val = await text({
				message: "DB_PATH",
				defaultValue: getCurrentValues().DB_PATH,
			});
			if (isCancel(val)) cancelled();
			process.env.DB_PATH = String(val);
			updateEnvFile(envPath, { DB_PATH: String(val) });
		} else if (setting === "MCP_AUTH") {
			const val = await select({
				message: "MCP_AUTH",
				options: [
					{
						value: "on",
						label: "on (recommended) — require YOT_API_KEY for the MCP server",
					},
					{
						value: "off",
						label: "off — MCP server runs with full write, no key",
					},
				],
			});
			if (isCancel(val)) cancelled();

			if (val === "off") {
				note(
					"⚠️  CRITICAL SECURITY EXPOSURE WARNING  ⚠️\n\n" +
						"🔴 Setting MCP_AUTH to 'off' makes the MCP server run every tool with\n" +
						"full WRITE scope and no key check.\n\n" +
						"ANYONE who can launch this server can read, modify, or MALICIOUSLY\n" +
						"WIPE your database. Never use this configuration in production.",
					"🚨 DANGER: SECURITY COMPLETELY DISABLED 🚨",
				);
				const ack = await confirm({
					message:
						"Do you explicitly understand the risks and wish to proceed anyway?",
					active: "Yes, I accept the risk",
					inactive: "No, abort immediately",
					initialValue: false,
				});
				if (isCancel(ack) || !ack) cancelled();
			}

			process.env.MCP_AUTH = String(val);
			updateEnvFile(envPath, { MCP_AUTH: String(val) });
		}

		note(formatValues(getCurrentValues()), `Updated config  (${envPath})`);
	}

	outro("Configuration saved.");
}

await main();
