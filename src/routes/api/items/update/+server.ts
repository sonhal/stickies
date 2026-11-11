import { serverConfig } from '$lib/server/config';
import { guardWrite, writeLimiter } from '$lib/server/write/guard';
import { executeUpdate, reply } from '$lib/server/write/execute';
import type { RequestHandler } from './$types';

/** POST { itemId, field, value } → updates one field of one item. See src/lib/server/write/validate.ts. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const g = await guardWrite(request, locals.session, url.origin, writeLimiter(serverConfig().writeRatePerMinute));
	if (!g.ok) return reply({ ok: false, error: g.error }, g.status);
	return executeUpdate(locals.session!, g.body);
};
