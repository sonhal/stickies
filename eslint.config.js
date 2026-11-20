import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default ts.config(
	{
		ignores: ['build/', '.svelte-kit/', 'node_modules/', 'introspect-out/', 'docs/']
	},
	js.configs.recommended,
	...ts.configs.recommended,
	...svelte.configs.recommended,
	{
		languageOptions: {
			globals: globals.node
		},
		rules: {
			// TypeScript (svelte-check) already reports undefined names, with type information.
			'no-undef': 'off',
			// `_`-prefixed names mark deliberately unused arguments and variables.
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }
			],
			// This rule makes sure links carry `paths.base`. The board is always served at the
			// root (no `kit.paths.base` in svelte.config.js), so every finding would be noise.
			// Turn it back on if the app ever moves under a sub-path.
			'svelte/no-navigation-without-resolve': 'off'
		}
	},
	{
		// The app runs in the browser as well as on the server.
		files: ['src/**'],
		languageOptions: { globals: { ...globals.browser, ...globals.node } }
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parserOptions: {
				projectService: true,
				extraFileExtensions: ['.svelte'],
				parser: ts.parser,
				svelteConfig
			}
		}
	},
	{
		// Dev scripts (e.g. introspect.ts) print raw GraphQL responses whose shape isn't known ahead of time.
		files: ['scripts/**'],
		rules: { '@typescript-eslint/no-explicit-any': 'off' }
	},
	{
		// Node CommonJS scripts (Playwright smoke test and screenshot helpers).
		files: ['**/*.cjs'],
		languageOptions: { sourceType: 'commonjs' },
		rules: {
			'@typescript-eslint/no-require-imports': 'off',
			// Crashes on CommonJS files (reads scope.isStrict, which is null there).
			'svelte/no-inner-declarations': 'off'
		}
	}
);
