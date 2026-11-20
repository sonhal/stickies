import { getContext, setContext } from 'svelte';
import type { ToolInstance } from '$lib/prioritization/types';

/** What "/" shows: the first view, or (on a kiosk whose list starts with one) a prioritization tool. */
export type Home = { kind: 'view'; id: string } | { kind: 'tool'; id: string } | null;

export interface ToolsContext {
	/** Prioritization tools listed in the sidebar and palette (on a kiosk, only those in KIOSK_VIEWS) */
	list: ToolInstance[];
	/** Every configured tool: a link (e.g. from an epic page) opens any of them, on a kiosk too */
	all: ToolInstance[];
	home: Home;
}

const KEY = Symbol('prioritization-tools');
export const setTools = (t: ToolsContext) => setContext(KEY, t);
export const getTools = () => getContext<ToolsContext>(KEY);
