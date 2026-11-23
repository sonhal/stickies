import { serverConfig } from '$lib/server/config';
import { guardWrite, writeLimiter } from '$lib/server/write/guard';
import { executeBulk, reply } from '$lib/server/write/execute';
import type { RequestHandler } from './$types';

/**
 * POST { field, changes: [{ itemId, value }] } → one field on up to BULK_MAX items, each checked
 * like a single edit (src/lib/server/write/validate.ts, planBulk). Answers with one result per item.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const cfg = serverConfig();
	const rate = writeLimiter(cfg.writeRatePerMinute);
	// The guard takes one hit for the request; the rest of the items are charged once it's valid.
	const g = await guardWrite(request, locals.session, url.origin, rate, cfg.kioskEdit);
	if (!g.ok) return reply({ ok: false, error: g.error }, g.status);
	return executeBulk(locals.session!, g.body, (n) => {
		const now = Date.now();
		return n <= 1 || rate.take(g.userKey, now, n - 1) ? true : rate.remaining(g.userKey, now);
	});
};
