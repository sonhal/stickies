/**
 * Unsaved description drafts, per item, for this tab. Switching to another issue or closing the
 * panel keeps what was typed; opening the editor again brings it back. Memory only: a draft can
 * hold private text, so nothing goes to storage. The page warns before a reload loses one.
 */
import { SvelteMap } from 'svelte/reactivity';

export interface Draft {
	text: string;
	/** Version of the GitLab description the draft started from */
	version: string;
}

export const descriptionDrafts = new SvelteMap<string, Draft>();
