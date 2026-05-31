import { randomInt } from "node:crypto";
import { hashKey, type Scope } from "./apikey.js";

const PIN_TTL_MS = 5 * 60 * 1000;

type PinEntry = { scope: Scope; expiresAt: number };

/**
 * Short-lived pairing PINs held only in this process's memory. A PIN is minted
 * by an authenticated client (scripts/auth.ts → POST /api/auth/pin) and redeemed
 * once by the browser (POST /api/auth/pair). PINs are stored hashed and removed
 * on first redemption, so they cannot be replayed.
 */
export class PairingService {
	private readonly pins = new Map<string, PinEntry>();

	constructor(private readonly ttlMs: number = PIN_TTL_MS) {}

	/** Mint a fresh 6-digit PIN bound to a scope. Returns the raw PIN. */
	createPin(scope: Scope): string {
		const pin = randomInt(0, 1_000_000).toString().padStart(6, "0");
		this.pins.set(hashKey(pin), { scope, expiresAt: Date.now() + this.ttlMs });
		return pin;
	}

	/** Consume a PIN (one-time). Returns its scope, or null if invalid/expired. */
	redeem(pin: string): Scope | null {
		const h = hashKey(pin);
		const entry = this.pins.get(h);
		if (!entry) return null;
		this.pins.delete(h);
		if (entry.expiresAt < Date.now()) return null;
		return entry.scope;
	}
}
