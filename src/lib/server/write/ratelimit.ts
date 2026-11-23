/**
 * Per-session write rate limit (sliding window, in memory). Protects GitLab and the user's
 * account from a runaway client. With several replicas this would move to Redis (see README).
 */
export class RateLimiter {
	private hits = new Map<string, number[]>();

	constructor(
		private limit: number,
		private windowMs = 60_000,
		private maxKeys = 5_000
	) {}

	/**
	 * Records `n` hits and returns true when all of them are allowed. All or nothing: when there
	 * isn't room for `n`, none is recorded (a bulk edit is refused whole, never cut off halfway).
	 */
	take(key: string, now = Date.now(), n = 1): boolean {
		const since = now - this.windowMs;
		const list = (this.hits.get(key) ?? []).filter((t) => t > since);
		if (list.length + n > this.limit) {
			this.hits.set(key, list);
			return false;
		}
		for (let i = 0; i < n; i++) list.push(now);
		this.hits.delete(key);
		this.hits.set(key, list);
		while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
		return true;
	}

	/** How many more hits `key` may make right now. */
	remaining(key: string, now = Date.now()): number {
		const since = now - this.windowMs;
		return Math.max(0, this.limit - (this.hits.get(key) ?? []).filter((t) => t > since).length);
	}
}
