/**
 * A view in a URL: `?v=<lz-string>`. Used for the current (unsaved) view state and for share links.
 * Decoding always goes through parseView, so a crafted link can't inject anything.
 */
// lz-string is CommonJS: use the default export so it works in SSR and the browser bundle.
import LZString from 'lz-string';
import { parseView } from '$lib/query/schema';
import type { ViewDefinition } from '$lib/query/types';

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
