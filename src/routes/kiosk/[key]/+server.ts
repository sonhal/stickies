import { error, redirect } from '@sveltejs/kit';
import { serverConfig } from '$lib/server/config';
import { writeSession } from '$lib/server/auth';
import { safeEqual } from '$lib/server/session';
import { SIDEBAR_PARAM, readSidebarParam } from '$lib/client/urlState';
import { CYCLE_PARAM, cycleParamValue } from '$lib/client/autoCycle';
import { STATUS_PARAM, statusParamValue } from '$lib/client/statusParam';
import { FILTER_PARAM } from '$lib/client/share';
import type { RequestHandler } from './$types';

/**
 * Open /kiosk/<KIOSK_KEY> once on the wall screen. It stores a 30-day kiosk cookie and
 * redirects to the board, so the key doesn't stay in the address bar. `?sidebar=hidden`,
 * `?cycle[=<seconds>]`, `?status=` and `?f=` (a board filter) are passed on (only those: nothing else from the query is forwarded), for a
 * full-width wall screen whose prioritization boards walk through their issues on their own.
 * The kiosk sees what GITLAB_TOKEN can see, so scope that token to the group only.
 */
export const GET: RequestHandler = ({ params, cookies, url }) => {
	const cfg = serverConfig();
	if (!cfg.kioskKey || !cfg.serviceToken || !safeEqual(params.key, cfg.kioskKey)) {
		error(404, 'Not found');
	}
	writeSession(cookies, cfg, { v: 1, kind: 'kiosk', issuedAt: Date.now() });
	const next = new URLSearchParams();
	if (readSidebarParam(url.searchParams)) next.set(SIDEBAR_PARAM, 'hidden');
	const cycle = cycleParamValue(url.searchParams);
	if (cycle !== null) next.set(CYCLE_PARAM, cycle);
	const status = statusParamValue(url.searchParams);
	if (status !== null) next.set(STATUS_PARAM, status);
	const f = url.searchParams.get(FILTER_PARAM);
	if (f) next.set(FILTER_PARAM, f.slice(0, 6000)); // decoded and validated by the board, like ?v=
	const qs = next
		.toString()
		.replace(/=(&|$)/g, '$1') // a bare `?cycle`, not `?cycle=`
		.replace(/%2C/gi, ',') // and a readable ?status=!toDo,!done
		.replace(/%21/g, '!');
	redirect(303, qs ? `/?${qs}` : '/');
};
