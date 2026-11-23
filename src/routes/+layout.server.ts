import { redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import type { LayoutServerLoad } from './$types';

export type Viewer =
	| { kind: 'user'; id: number; name: string; username: string }
	/** edit: KIOSK_EDIT is on, so the kiosk can change issues */
	| { kind: 'kiosk'; edit: boolean }
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
				? { kind: 'kiosk', edit: serverConfig().kioskEdit }
				: null;
	return { viewer };
};
