import { redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import { safeReturnTo } from '$lib/server/session';
import type { PageServerLoad } from './$types';

const ERRORS: Record<string, string> = {
	disabled: 'GitLab sign-in is not enabled on this board.',
	denied: 'Sign-in was cancelled or denied in GitLab.',
	expired: 'That sign-in attempt expired. Please try again.',
	nocode: 'GitLab did not complete the sign-in. Please try again.',
	failed: 'Sign-in failed. Please try again, or ask the board admin to check the server log.',
	scope: 'The GitLab application must have exactly the api scope. Ask the board admin to fix the application settings.'
};

export const load: PageServerLoad = ({ locals, url }) => {
	const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
	if (locals.session) redirect(303, returnTo);
	const cfg = serverConfig();
	return {
		oauthEnabled: !!cfg.oauth,
		gitlabHost: new URL(cfg.gitlabUrl).host,
		returnTo,
		error: ERRORS[url.searchParams.get('error') ?? ''] ?? null,
		signedOut: url.searchParams.has('signedOut'),
		sessionDays: Math.round(cfg.sessionMaxAgeMs / 86_400_000 * 10) / 10
	};
};
