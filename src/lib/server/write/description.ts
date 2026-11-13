/**
 * Editing an item's description. The board's items only carry a shortened plain-text copy (see
 * normalize.ts), so the editor first loads the full Markdown from GitLab, with the viewer's token.
 *
 * Two people can edit the same description. GitLab keeps whatever is saved last, so the editor
 * says which text it started from (a hash, `version`) and the server refuses to save over a
 * description that has changed since (executeUpdate). The editor then keeps the user's text.
 */
import { createHash } from 'node:crypto';
import { serverConfig } from '../config';
import type { Session } from '../session';
import { credentialFor, GitLabError, graphql } from '../gitlab/client';
import { DESCRIPTION_QUERY } from '../gitlab/queries';

export function descriptionVersion(text: string): string {
	return createHash('sha256').update(text, 'utf8').digest('hex');
}

interface Raw {
	workItem?: { id: string; widgets?: ({ type?: string; description?: string | null } | null)[] | null } | null;
}

/** The item's current Markdown description ('' when it has none). Throws GitLabError. */
export async function fetchDescription(session: Session, itemId: string): Promise<string> {
	const cfg = serverConfig();
	const { data } = await graphql<Raw>(cfg, credentialFor(session, cfg), DESCRIPTION_QUERY, { id: itemId });
	if (!data.workItem) throw new GitLabError('That item no longer exists in GitLab, or you lost access.', 404);
	const w = (data.workItem.widgets ?? []).find((x) => x && typeof x.description === 'string');
	return w?.description ?? '';
}
