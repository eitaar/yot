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
		PORT: process.env.PORT ?? "3000",
		DB_PATH: process.env.DB_PATH ?? "data.db",
		MCP_AUTH: process.env.MCP_AUTH ?? "on",
	};
}

function formatValues(v: ReturnType<typeof getCurrentValues>) {
	return `PORT     ${v.PORT}\nDB_PATH  ${v.DB_PATH}\nMCP_AUTH ${v.MCP_AUTH}`;
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
					label: "MCP_AUTH — require auth on /mcp endpoint",
				},
				{ value: "done", label: "Done" },
			],
		});
		if (isCancel(setting)) cancelled();
		if (setting === "done") break;

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
					{ value: "on", label: "on (recommended) — require API key for /mcp" },
					{
						value: "off",
						label: "off — /mcp open to unauthenticated requests",
					},
				],
			});
			if (isCancel(val)) cancelled();

			if (val === "off") {
				note(
					"⚠️  CRITICAL SECURITY EXPOSURE WARNING  ⚠️\n\n" +
						"🔴 Setting MCP_AUTH to 'off' leaves the `/mcp` endpoint completely UNPROTECTED.\n\n" +
						"ANYONE who can reach this port or server URL can read, modify, or\n" +
						"MALICIOUSLY WIPE your database. Never use this configuration in production.",
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
