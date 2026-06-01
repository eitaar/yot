import { lookup } from "node:dns/promises";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { isIP } from "node:net";
import { join } from "node:path";
import { ValidationError } from "../core/errors.js";
import { newId } from "../core/id.js";

const MIME_EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/gif": "gif",
};
const MAX_BYTES = 5 * 1024 * 1024;
const NAME_RE = /^[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;

/** Owns local cover-image storage under a single directory. */
export class ImageService {
	constructor(private readonly dir: string) {}

	assertSafeName(name: string): void {
		if (!NAME_RE.test(name)) throw new ValidationError(`Unsafe image name: ${name}`);
	}

	absPath(name: string): string {
		this.assertSafeName(name);
		return join(this.dir, name);
	}

	exists(name: string): boolean {
		return NAME_RE.test(name) && existsSync(join(this.dir, name));
	}

	read(name: string): { bytes: Buffer; mime: string } {
		const path = this.absPath(name);
		const ext = name.slice(name.lastIndexOf(".") + 1);
		const mime =
			Object.keys(MIME_EXT).find((m) => MIME_EXT[m] === ext) ??
			"application/octet-stream";
		return { bytes: readFileSync(path), mime };
	}

	saveBytes(bytes: Uint8Array, mime: string): string {
		const ext = MIME_EXT[mime];
		if (!ext) throw new ValidationError(`Unsupported image type: ${mime || "unknown"}`);
		if (bytes.byteLength > MAX_BYTES)
			throw new ValidationError("Image exceeds the 5 MB limit");
		this.ensureDir();
		const name = `${newId()}.${ext}`;
		writeFileSync(join(this.dir, name), bytes);
		return name;
	}

	async saveFromUrl(url: string): Promise<string> {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw new ValidationError("Invalid URL");
		}
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
			throw new ValidationError("Image URL must be http(s)");
		// Note: DNS resolution here and inside fetch() are independent (TOCTOU /
		// DNS-rebinding). For a single-user self-hosted app the window is negligible.
		if (await isPrivateHost(parsed.hostname))
			throw new ValidationError("Refusing to fetch a private/loopback address");
		// redirect: "error" — a public URL must not be able to 302 into a private
		// address, which would bypass the isPrivateHost check above.
		const res = await fetch(parsed, {
			redirect: "error",
			signal: AbortSignal.timeout(10_000),
		});
		if (!res.ok) throw new ValidationError(`Image fetch failed: ${res.status}`);
		const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
		if (!MIME_EXT[mime])
			throw new ValidationError(`Unsupported image type: ${mime || "unknown"}`);
		const declared = Number(res.headers.get("content-length") ?? 0);
		if (declared > MAX_BYTES)
			throw new ValidationError("Image exceeds the 5 MB limit");
		const bytes = new Uint8Array(await res.arrayBuffer());
		return this.saveBytes(bytes, mime);
	}

	remove(name: string): void {
		try {
			if (NAME_RE.test(name)) unlinkSync(join(this.dir, name));
		} catch {
			// best-effort: missing/locked files are fine to ignore
		}
	}

	private ensureDir(): void {
		if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
	}
}

/** True if a hostname is localhost or resolves to a private/loopback address. */
export async function isPrivateHost(hostname: string): Promise<boolean> {
	const host = hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
	if (host === "localhost") return true;
	const addrs = isIP(host) ? [host] : await safeLookup(host);
	if (addrs.length === 0) return true; // unresolvable → treat as unsafe
	return addrs.some(isPrivateIp);
}

async function safeLookup(host: string): Promise<string[]> {
	try {
		return (await lookup(host, { all: true })).map((r) => r.address);
	} catch {
		return [];
	}
}

function isPrivateIp(ip: string): boolean {
	if (ip.includes(":")) {
		const v = ip.toLowerCase();
		if (v.startsWith("::ffff:")) {
			const mapped = v.slice(7);
			// A dotted-decimal mapped address is safe to re-check; a hex-form one
			// (still contains ':') is treated as private to avoid a bypass.
			return mapped.includes(":") ? true : isPrivateIp(mapped);
		}
		return (
			v === "::1" ||
			v.startsWith("fc") ||
			v.startsWith("fd") ||
			v.startsWith("fe80")
		);
	}
	const p = ip.split(".").map(Number);
	if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
	const [a, b] = p;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 100 && b >= 64 && b <= 127)
	);
}
