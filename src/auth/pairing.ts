import { randomInt } from "node:crypto";
import { hashKey, type Scope } from "./apikey.js";

const PIN_TTL_MS = 5 * 60 * 1000;

type PinEntry = { scope: Scope; expiresAt: number };

export class PairingService {
	private readonly pins = new Map<string, PinEntry>();

	constructor(private readonly ttlMs: number = PIN_TTL_MS) {}

	createPin(scope: Scope): string {
		const pin = randomInt(0, 1_000_000).toString().padStart(6, "0");
		this.pins.set(hashKey(pin), { scope, expiresAt: Date.now() + this.ttlMs });
		return pin;
	}

	redeem(pin: string): Scope | null {
		const h = hashKey(pin);
		const entry = this.pins.get(h);
		if (!entry) return null;
		this.pins.delete(h);
		if (entry.expiresAt < Date.now()) return null;
		return entry.scope;
	}
}
