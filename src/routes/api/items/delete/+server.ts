import { serverConfig } from '$lib/server/config';
import { guardWrite, writeLimiter } from '$lib/server/write/guard';
import { reply } from '$lib/server/write/execute';
import { executeDelete } from '$lib/server/write/delete';
import type { RequestHandler } from './$types';

/** POST { itemId } → deletes one item in GitLab. See src/lib/server/write/delete.ts. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const g = await guardWrite(request, locals.session, url.origin, writeLimiter(serverConfig().writeRatePerMinute));
	if (!g.ok) return reply({ ok: false, error: g.error }, g.status);
	return executeDelete(locals.session!, g.body);
};
