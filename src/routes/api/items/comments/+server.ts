import { serverConfig } from '$lib/server/config';
import { guardWrite, writeLimiter } from '$lib/server/write/guard';
import { reply } from '$lib/server/write/execute';
import { executeComment, executeDeleteComment, executeEditComment, readComments } from '$lib/server/write/comments';
import type { RequestHandler } from './$types';

/**
 * Comments on one item. See src/lib/server/write/comments.ts.
 *   GET    ?id=<work item gid>               → { ok, threads, more }, oldest first (the kiosk too, without internal notes)
 *   POST   { itemId, body, discussionId? }   → adds a comment, or a reply to a thread
 *   PATCH  { itemId, noteId, body }          → edits a comment
 *   DELETE { itemId, noteId }                → deletes a comment
 * Writes: signed-in users, and the kiosk when KIOSK_EDIT is on (as GITLAB_TOKEN's user).
 */
export const GET: RequestHandler = async ({ locals, url }) => readComments(locals.session, url.searchParams.get('id') ?? '');

const write =
	(run: typeof executeComment): RequestHandler =>
	async ({ request, locals, url }) => {
		const cfg = serverConfig();
		const g = await guardWrite(request, locals.session, url.origin, writeLimiter(cfg.writeRatePerMinute), cfg.kioskEdit);
		if (!g.ok) return reply({ ok: false, error: g.error }, g.status);
		return run(locals.session!, g.body);
	};

export const POST = write(executeComment);
export const PATCH = write(executeEditComment);
export const DELETE = write(executeDeleteComment);
