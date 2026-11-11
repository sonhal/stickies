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

	/** Records a hit and returns true when it's allowed. */
	take(key: string, now = Date.now()): boolean {
		const since = now - this.windowMs;
		const list = (this.hits.get(key) ?? []).filter((t) => t > since);
		if (list.length >= this.limit) {
			this.hits.set(key, list);
			return false;
		}
		list.push(now);
		this.hits.delete(key);
		this.hits.set(key, list);
		while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
		return true;
	}
}
