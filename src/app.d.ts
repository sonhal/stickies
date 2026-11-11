// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Session } from '$lib/server/session';

declare global {
	namespace App {
		interface Locals {
			/** Set by hooks.server.ts. null only on public routes (sign-in, callback, kiosk link). */
			session: Session | null;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
