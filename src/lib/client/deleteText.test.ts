import { describe, expect, it } from 'vitest';
import { item } from '$lib/testing/factory';
import { deleteText } from './deleteText';

describe('deleteText', () => {
	const epic = item({}, { type: 'Epic', title: 'Payments v2', ref: 'acme&3' });

	it('names the item and says it is final', () => {
		const t = deleteText(epic, [epic]);
		expect(t.heading).toBe('Delete epic');
		expect(t.message).toBe("Delete acme&3 “Payments v2”? This can't be undone from the board.");
		expect(t.note).toBeNull();
		expect(t.confirmLabel).toBe('Delete epic');
	});

	it('says sub-items stay, and is careful about child epics', () => {
		const a = item({}, { parentId: epic.id });
		const b = item({}, { parentId: epic.id });
		const sub = item({}, { type: 'Epic', parentId: epic.id });
		expect(deleteText(epic, [epic, a]).note).toBe('Its 1 sub-item stays, without this parent.');
		expect(deleteText(epic, [epic, a, b]).note).toBe('Its 2 sub-items stay, without this parent.');
		expect(deleteText(epic, [epic, a, sub]).note).toBe(
			'Its 1 sub-item stays, without this parent. It has 1 child epic: depending on your GitLab version, it may be deleted with it.'
		);
	});
});
