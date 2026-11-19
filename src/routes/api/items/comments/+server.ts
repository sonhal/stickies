import { serverConfig } from '$lib/server/config';
import { guardWrite, writeLimiter } from '$lib/server/write/guard';
import { reply } from '$lib/server/write/execute';
import { executeComment, readComments } from '$lib/server/write/comments';
import type { RequestHandler } from './$types';

/** GET ?id=<work item gid> → { ok, threads, more }: the item's comments, oldest first. */
export const GET: RequestHandler = async ({ locals, url }) => readComments(locals.session, url.searchParams.get('id') ?? '');

/** POST { itemId, body, discussionId? } → adds a comment, or a reply to a thread. See src/lib/server/write/comments.ts. */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const g = await guardWrite(request, locals.session, url.origin, writeLimiter(serverConfig().writeRatePerMinute));
	if (!g.ok) return reply({ ok: false, error: g.error }, g.status);
	return executeComment(locals.session!, g.body);
};
