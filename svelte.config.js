import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';

/**
 * The version shown in the sidebar footer and used by SvelteKit to notice a new deploy.
 * BOARD_VERSION wins (for builds without a .git directory, e.g. a Docker build: pass the commit in);
 * otherwise the short commit hash, with "-dirty" when there are uncommitted changes.
 * Falls back to "dev" when neither is available.
 */
function boardVersion() {
	if (process.env.BOARD_VERSION) return process.env.BOARD_VERSION.trim();
	try {
		const git = (/** @type {string[]} */ ...args) =>
			execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
		const hash = git('rev-parse', '--short=8', 'HEAD');
		return git('status', '--porcelain', '--untracked-files=no') ? `${hash}-dirty` : hash;
	} catch {
		return 'dev';
	}
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		// Node server: run it on an internal box / container next to the standup screen.
		// Swap for adapter-auto / adapter-vercel etc. if you host elsewhere.
		adapter: adapter(),
		// Read in the app via `version` from $app/environment
		version: { name: boardVersion() },
		// The page never loads anything from another origin: GitLab is only
		// called from the server, and avatars are rendered as initials.
		csp: {
			mode: 'auto',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:'],
				'connect-src': ['self'],
				'font-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
