import { describe, expect, it } from 'vitest';
import { markdownToText, truncate } from './text';

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
