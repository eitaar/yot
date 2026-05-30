type Bucket = { count: number; resetAt: number };

export class RateLimiter {
	private readonly buckets = new Map<string, Bucket>();

	constructor(
		private readonly max: number = 5,
		private readonly windowMs: number = 60_000,
	) {}

	isBlocked(key: string): boolean {
		const b = this.buckets.get(key);
		if (!b) return false;
		if (b.resetAt < Date.now()) {
			this.buckets.delete(key);
			return false;
		}
		return b.count >= this.max;
	}

	recordFailure(key: string): void {
		const nowMs = Date.now();
		const b = this.buckets.get(key);
		if (!b || b.resetAt < nowMs) {
			this.buckets.set(key, { count: 1, resetAt: nowMs + this.windowMs });
			return;
		}
		b.count++;
	}

	reset(key: string): void {
		this.buckets.delete(key);
	}
}
