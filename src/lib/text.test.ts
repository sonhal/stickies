import { describe, expect, it } from 'vitest';
import { MARKDOWN_INPUT_MAX, markdownToText, truncate } from './text';

describe('markdownToText', () => {
	it('keeps the words and drops the syntax', () => {
		const md = [
			'<!-- template: fill this in -->',
			'## Problem',
			'Customers in the **EU** get a _500_ when the invoice has `vat_id` set.',
			'See [the log](https://example.com/log) and ![screenshot](/uploads/a.png).',
			'',
			'',
			'',
			'- [x] reproduce',
			'- [ ] fix',
			'* note'
		].join('\n');
		expect(markdownToText(md)).toBe(
			[
				'Problem',
				'Customers in the EU get a 500 when the invoice has vat_id set.',
				'See the log and [image: screenshot].',
				'',
				'☑ reproduce',
				'☐ fix',
				'• note'
			].join('\n')
		);
	});

	it('strips HTML tags so nothing can be injected', () => {
		expect(markdownToText('<script>alert(1)</script>hi <b>there</b>')).toBe('alert(1)hi there');
	});

	it('keeps the blank line before a heading or list', () => {
		expect(markdownToText('Intro.\n\n## Next steps\n\n- one')).toBe('Intro.\n\nNext steps\n\n• one');
	});

	it('handles empty input', () => {
		expect(markdownToText(null)).toBe('');
	});
});

describe('truncate', () => {
	it('cuts at a word boundary', () => {
		expect(truncate('one two three four', 12)).toEqual({ text: 'one two…', truncated: true });
		expect(truncate('short', 12)).toEqual({ text: 'short', truncated: false });
	});
});

describe('markdownToText stays fast on hostile input (review M5)', () => {
	// Each of these took 12-34 s at 80-200 KB before the fix. 1 MB is GitLab's description limit.
	const MB = 1_000_000;
	const cases: [string, string][] = [
		['unclosed images', '![a'.repeat(MB / 3)],
		['unclosed links', '[a'.repeat(MB / 2)],
		['unclosed fences', '```a\n'.repeat(MB / 5)],
		['unclosed tags', '<a'.repeat(MB / 2)],
		['unclosed comments', '<!--'.repeat(MB / 4)],
		['unclosed bold', '**a'.repeat(MB / 3)],
		['unclosed code', '`a'.repeat(MB / 2)],
		['rule-like line', '- '.repeat(MB / 2) + 'x']
	];
	for (const [name, input] of cases) {
		it(`${name}: 1 MB in well under a second`, () => {
			const t = performance.now();
			markdownToText(input);
			expect(performance.now() - t).toBeLessThan(250);
		});
	}

	it('only converts the first MARKDOWN_INPUT_MAX characters', () => {
		const out = markdownToText('a'.repeat(MARKDOWN_INPUT_MAX) + 'TAIL');
		expect(out.endsWith('TAIL')).toBe(false);
	});

	it('still handles normal Markdown the same way', () => {
		expect(markdownToText('<!-- hidden -->\n```js\nconst x = 1;\n```\n**Bold** and [link](https://x) ![pic](y.png)')).toBe(
			'const x = 1;\n\nBold and link [image: pic]'.replace('\n\n', '\n')
		);
	});
});
