/**
 * A view in a URL: `?v=<lz-string>`. Used for the current (unsaved) view state and for share links.
 * A prioritization board's filter in a URL: `?f=<lz-string>`, the same encoding for the filter alone.
 * Decoding always goes through parseView / parseFilter, so a crafted link can't inject anything.
 */
// lz-string is CommonJS: use the default export so it works in SSR and the browser bundle.
import LZString from 'lz-string';
import { parseFilter, parseView } from '$lib/query/schema';
import type { FilterGroup, ViewDefinition } from '$lib/query/types';

/** Keep URLs well under common limits (and the decompressor's work bounded). */
const MAX_ENCODED = 6000;

export function encodeView(view: ViewDefinition): string {
	return LZString.compressToEncodedURIComponent(JSON.stringify(view));
}

export function decodeView(param: string | null | undefined): ViewDefinition | null {
	if (!param || param.length > MAX_ENCODED) return null;
	try {
		const json = LZString.decompressFromEncodedURIComponent(param);
		if (!json || json.length > 100_000) return null;
		const r = parseView(JSON.parse(json));
		return r.ok ? r.view : null;
	} catch {
		return null;
	}
}

/** The URL param a prioritization board keeps its filter in. */
export const FILTER_PARAM = 'f';

export function encodeFilter(filter: FilterGroup): string {
	return LZString.compressToEncodedURIComponent(JSON.stringify(filter));
}

export function decodeFilter(param: string | null | undefined): FilterGroup | null {
	if (!param || param.length > MAX_ENCODED) return null;
	try {
		const json = LZString.decompressFromEncodedURIComponent(param);
		if (!json || json.length > 100_000) return null;
		return parseFilter(JSON.parse(json));
	} catch {
		return null;
	}
}
