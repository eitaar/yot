import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
	it("blocks a key after reaching max failures and unblocks on reset", () => {
		const rl = new RateLimiter(2, 60_000);
		assert.equal(rl.isBlocked("ip"), false);
		rl.recordFailure("ip");
		assert.equal(rl.isBlocked("ip"), false);
		rl.recordFailure("ip");
		assert.equal(rl.isBlocked("ip"), true);
		rl.reset("ip");
		assert.equal(rl.isBlocked("ip"), false);
	});

	it("expires the window", () => {
		const rl = new RateLimiter(1, -1); // window already elapsed
		rl.recordFailure("ip");
		assert.equal(rl.isBlocked("ip"), false);
	});
});
