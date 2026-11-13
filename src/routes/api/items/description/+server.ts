import { json } from '@sveltejs/kit';
import { loadBoard } from '$lib/server/gitlab/load';
import { GitLabError } from '$lib/server/gitlab/client';
import { descriptionVersion, fetchDescription } from '$lib/server/write/description';
import { DESCRIPTION_MAX } from '$lib/server/write/validate';
import type { RequestHandler } from './$types';

const ITEM_ID = /^gid:\/\/gitlab\/WorkItem\/\d+$/;
const headers = { 'cache-control': 'private, no-store' };

/**
 * GET ?id=<work item gid> → { ok, description, version, editable } for the description editor.
 * Signed-in users only (the kiosk can't edit), and only for items on the viewer's own board,
 * like every write.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	const session = locals.session;
	if (!session) return json({ ok: false, error: 'Not signed in' }, { status: 401, headers });
	if (session.kind !== 'user') return json({ ok: false, error: 'The kiosk screen is read-only' }, { status: 403, headers });
	const id = url.searchParams.get('id') ?? '';
	if (!ITEM_ID.test(id)) return json({ ok: false, error: 'Invalid request' }, { status: 400, headers });

	const board = await loadBoard(session);
	if (!board.items.some((i) => i.id === id)) {
		return json({ ok: false, error: 'That item is not on your board (it may have been moved or you lost access)' }, { status: 404, headers });
	}
	try {
		const description = await fetchDescription(session, id);
		return json(
			{ ok: true, description, version: descriptionVersion(description), editable: description.length <= DESCRIPTION_MAX },
			{ headers }
		);
	} catch (err) {
		if (err instanceof GitLabError) {
			const status = err.status === 401 || err.status === 403 || err.status === 404 ? err.status : 502;
			return json({ ok: false, error: status === 401 ? 'GitLab no longer accepts your sign-in. Please sign in again.' : err.message }, { status, headers });
		}
		console.error('[description]', err);
		return json({ ok: false, error: 'Unexpected error while loading the description.' }, { status: 500, headers });
	}
};
