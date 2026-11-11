import { serverConfig } from '$lib/server/config';
import { guardWrite, writeLimiter } from '$lib/server/write/guard';
import { executeCreate, reply } from '$lib/server/write/execute';
import type { RequestHandler } from './$types';

/** POST { title, projectId, type?, parentId?, description?, values? } → creates an item. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const g = await guardWrite(request, locals.session, url.origin, writeLimiter(serverConfig().writeRatePerMinute));
	if (!g.ok) return reply({ ok: false, error: g.error }, g.status);
	return executeCreate(locals.session!, g.body);
};
