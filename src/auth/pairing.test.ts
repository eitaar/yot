import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PairingService } from "./pairing.js";

describe("PairingService", () => {
	it("creates a 6-digit pin and redeems it once with its scope", () => {
		const svc = new PairingService();
		const pin = svc.createPin("write");
		assert.match(pin, /^\d{6}$/);
		assert.equal(svc.redeem(pin), "write");
		assert.equal(svc.redeem(pin), null); // one-time
	});

	it("returns null for an unknown pin", () => {
		const svc = new PairingService();
		assert.equal(svc.redeem("000000"), null);
	});

	it("rejects an expired pin", () => {
		const svc = new PairingService(-1); // TTL in the past
		const pin = svc.createPin("read");
		assert.equal(svc.redeem(pin), null);
	});
});
