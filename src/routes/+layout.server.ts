import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export type Viewer =
	| { kind: 'user'; id: number; name: string; username: string }
	| { kind: 'kiosk' }
	| null;

export const load: LayoutServerLoad = ({ locals, url }) => {
	const s = locals.session;
	if (!s && url.pathname !== '/signin') {
		redirect(303, `/signin?returnTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	// Never send tokens to the browser: only the display name and the numeric id
	// (the id keys this person's saved views in localStorage).
	const viewer: Viewer =
		s?.kind === 'user'
			? { kind: 'user', id: s.user.id, name: s.user.name, username: s.user.username }
			: s?.kind === 'kiosk'
				? { kind: 'kiosk' }
				: null;
	return { viewer };
};
