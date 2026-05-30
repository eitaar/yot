import { intro, isCancel, note, outro, select } from "@clack/prompts";

try {
	process.loadEnvFile();
} catch {}

const PORT = Number(process.env.PORT ?? 4010);
const KEY = process.env.YOT_API_KEY;
const BASE = `http://localhost:${PORT}`;

async function main() {
	intro("Pair a browser with the calendar backend");

	if (!KEY) {
		outro("No YOT_API_KEY in .env — run `npm run init` first.");
		process.exit(1);
	}

	const scope = await select({
		message: "Scope for this browser session",
		options: [
			{ value: "write", label: "write — full read/write access" },
			{ value: "read", label: "read — read-only access" },
		],
	});
	if (isCancel(scope)) {
		outro("Cancelled.");
		process.exit(0);
	}

	let res: Response;
	try {
		res = await fetch(`${BASE}/api/auth/pin`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${KEY}`,
			},
			body: JSON.stringify({ scope }),
		});
	} catch {
		outro(`Could not reach ${BASE}. Is the server running? (npm run dev)`);
		process.exit(1);
	}

	if (!res.ok) {
		outro(`Server returned ${res.status}. Check that YOT_API_KEY is valid.`);
		process.exit(1);
	}

	const { pin } = (await res.json()) as { pin: string };
	note(
		`Pairing PIN:   ${pin}\n\nValid for 5 minutes. Enter it in the browser.`,
		"Enter this PIN in the web app",
	);
	outro("Waiting for you to pair in the browser…");
}

await main();
