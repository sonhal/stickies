/**
 * Playwright smoke test against scripts/fake-gitlab.mjs.
 *
 *   node scripts/fake-gitlab.mjs &                       # fake GitLab on :4010
 *   . scripts/dev-env.sh && npm run build && node build &  # board on :3000 (or `npm run dev` on :5173)
 *   BOARD_URL=http://localhost:3000 node tests/smoke.cjs
 *
 * Uses the preinstalled Playwright + Chromium (require('playwright')). Exits non-zero on failure.
 */
const { chromium } = require('playwright');

const BASE = process.env.BOARD_URL || 'http://localhost:5173';
const FAKE = process.env.FAKE_GITLAB_URL || 'http://localhost:4010';
const only = process.argv.slice(2);

const steps = [];
const step = (name, fn) => steps.push({ name, fn });
/** Navigate and wait until the app has hydrated (keyboard handlers are live). */
async function open(p, path) {
	await p.goto(BASE + path);
	await p.waitForSelector('html[data-ready]');
}

/** The number (for /issue/<n>) of an item the fake GitLab seeded with comments by other people. */
async function itemWithSeededComments() {
	const gql = async (op, variables) =>
		(await fetch(`${FAKE}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: `query ${op} { x }`, variables }) })).json();
	const list = await gql('BoardGroupWorkItems', { state: 'opened', first: 100 });
	for (const n of list.data.group.workItems.nodes) {
		const c = await gql('BoardComments', { id: n.id, first: 100 });
		const notes = c.data.workItem.widgets[0].discussions.nodes.flatMap((d) => d.notes.nodes);
		if (notes.some((x) => x.internal) && notes.some((x) => !x.userPermissions.adminNote)) return n.id.split('/').pop();
	}
	throw new Error('the fake GitLab has no seeded comments');
}

async function writes() {
	return (await (await fetch(`${FAKE}/__writes`)).json()).writes;
}

step('sign in through OAuth', async (p) => {
	await p.goto(BASE + '/');
	await p.waitForURL('**/signin**');
	await p.click('text=Sign in with GitLab');
	await p.waitForSelector('nav[aria-label="Board navigation"]');
});

step('matrix (priority × effort) renders quadrants and the walk-through', async (p) => {
	await open(p, '/p/priority-effort');
	await p.waitForSelector('[aria-label="Value vs effort matrix"]');
	if ((await p.locator('.note').count()) < 5) throw new Error('too few notes');
	await p.keyboard.press('ArrowRight');
	await p.waitForSelector('.note.selected');
});

step('prioritization: ?status= and the filter bar are the same Status filter', async (p) => {
	const labels = async () => new Set(await p.locator('.note .status-label').allInnerTexts());
	const query = () => decodeURIComponent(new URL(p.url()).search);
	// Default: the config filter hides done and canceled
	await open(p, '/p/priority-effort');
	await p.waitForSelector('[aria-label="Value vs effort matrix"]');
	await p.waitForSelector('text=Status is none of done, canceled');
	if ((await labels()).has('Done')) throw new Error('done issues shown by default');
	// Only done
	await open(p, '/p/priority-effort?status=done');
	await p.waitForSelector('text=Status is any of done');
	const done = await labels();
	if (!done.has('Done') || done.size !== 1) throw new Error(`?status=done shows ${[...done]}`);
	// Everything but to do and done
	await open(p, '/p/priority-effort?status=!toDo,!done&cycle=30');
	await p.waitForSelector('text=Status is none of toDo, done');
	const rest = await labels();
	if (rest.has('To do') || rest.has('Done') || rest.size === 0) throw new Error(`?status=!toDo,!done shows ${[...rest]}`);
	// The filter bar writes the param (keeping ?cycle), and Reset filter removes it
	await p.click('button[aria-label^="Remove filter: Status"]');
	await p.waitForURL((u) => u.search.includes('status=all'));
	if (query() !== '?cycle=30&status=all') throw new Error(`after removing the chip: ${query()}`);
	await p.click('text=+ Filter');
	await p.locator('.menu-label, button, [role="option"]').getByText('Status', { exact: true }).first().click();
	await p.getByText('Any "done" status', { exact: true }).click();
	await p.click('button:has-text("Apply")');
	await p.waitForURL((u) => decodeURIComponent(u.search).endsWith('status=done'));
	await p.click('text=Reset filter');
	await p.waitForURL((u) => !u.search.includes('status'));
	if (query() !== '?cycle=30') throw new Error(`after reset: ${query()}`);
});

step('matrix auto-cycle (?cycle) advances, restarts on a pick, pauses on Space', async (p) => {
	// The old Eisenhower address redirects to priority × effort and keeps ?cycle
	await open(p, '/p/standup?cycle=3');
	await p.waitForURL('**/p/priority-effort?cycle=3');
	await p.waitForSelector('.note.selected');
	const sel = () => p.locator('.note.selected').getAttribute('data-item');
	const first = await sel();
	await p.waitForTimeout(3400);
	if ((await sel()) === first) throw new Error('auto-cycle did not advance');
	await p.waitForTimeout(1500);
	await p.locator('.note').nth(4).click();
	const picked = await sel();
	await p.waitForTimeout(2400);
	if ((await sel()) !== picked) throw new Error('a manual pick did not restart the countdown');
	await p.keyboard.press('Space');
	const held = await sel();
	await p.waitForTimeout(3600);
	if ((await sel()) !== held) throw new Error('Space did not pause auto-cycle');
	await p.keyboard.press('Escape');
});

step('list view groups and opens the detail panel', async (p) => {
	await open(p, '/v/my-issues');
	await p.waitForSelector('.list .row');
	await p.locator('.row .hit').first().click();
	await p.waitForSelector('aside.detail article');
});

step('inline edit: status via keyboard (s) is saved', async (p) => {
	const before = await writes();
	await p.keyboard.press('Escape');
	await p.locator('.row .hit').first().click();
	await p.waitForSelector('aside.detail article');
	const current = (await p.locator('aside.detail dd').first().textContent()) ?? '';
	await p.keyboard.press('s');
	await p.waitForSelector('[role="dialog"][aria-label="Edit Status"] input');
	await p.keyboard.type(current.includes('To do') ? 'In progress' : 'To do');
	await p.keyboard.press('Enter');
	for (let i = 0; i < 20 && (await writes()) === before; i++) await p.waitForTimeout(150);
	if ((await writes()) !== before + 1) throw new Error('no write reached GitLab');
});

step('inline edit: a number field (Story points) is saved as a number', async (p) => {
	await open(p, '/v/my-issues');
	await p.locator('.row .hit').first().click();
	await p.waitForSelector('aside.detail article');
	const before = await writes();
	await p.locator('aside.detail dt', { hasText: 'Story points' }).locator('xpath=following-sibling::dd[1]').locator('button').first().click();
	await p.locator('[role="dialog"][aria-label="Edit Story points"] input[type="number"]').fill('7');
	await p.keyboard.press('Enter');
	for (let i = 0; i < 20 && (await writes()) === before; i++) await p.waitForTimeout(150);
	if ((await writes()) !== before + 1) throw new Error('no write reached GitLab');
	const ref = (await p.locator('aside.detail .ref').innerText()).trim();
	const v = await p.evaluate(async (r) => {
		const b = (await (await fetch('/api/board')).json()).board;
		const key = b.registry.fields.find((f) => f.name === 'Story points').key;
		return b.items.find((i) => i.ref === r)?.values[key];
	}, ref);
	if (v?.value !== 7) throw new Error(`story points are ${JSON.stringify(v)}`);
});

step('weight is hidden: not in the panel, not on w, and the server refuses it', async (p) => {
	await p.waitForSelector('aside.detail article');
	if (await p.locator('aside.detail dt', { hasText: /^Weight$/ }).count()) throw new Error('the panel still shows Weight');
	const reg = await p.evaluate(async () => (await (await fetch('/api/board')).json()).board.registry.fields.map((f) => f.key));
	if (reg.includes('native:weight')) throw new Error('weight is still in the registry');
	const before = await writes();
	await p.keyboard.press('w');
	await p.waitForTimeout(200);
	if (await p.locator('[role="dialog"][aria-label="Edit Weight"]').count()) throw new Error('w still opens a weight editor');
	const status = await p.evaluate(async () => {
		const id = (await (await fetch('/api/board')).json()).board.items[0].id;
		const r = await fetch('/api/items/update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: id, field: 'native:weight', value: 3 }) });
		return r.status;
	});
	if (status < 400) throw new Error(`a weight write was accepted (${status})`);
	if ((await writes()) !== before) throw new Error('a weight write reached GitLab');
});

step('a write GitLab rejects is rolled back with a toast', async (p) => {
	await p.waitForSelector('aside.detail article');
	const before = await p.locator('aside.detail h2').textContent();
	await p.click('aside.detail h2 button');
	await p.fill('aside.detail textarea.title-input', '[reject] nope');
	await p.keyboard.press('Enter');
	await p.waitForSelector('.toast.error:has-text("permission")');
	const after = await p.locator('aside.detail h2').textContent();
	if (after !== before) throw new Error(`title not rolled back: ${after}`);
});

step("GitLab's top-level permission error says 'no permission' (review M2)", async (p) => {
	await p.waitForSelector('aside.detail article');
	const before = await p.locator('aside.detail h2').textContent();
	const res = p.waitForResponse((r) => r.url().endsWith('/api/items/update'));
	await p.click('aside.detail h2 button');
	await p.fill('aside.detail textarea.title-input', '[forbid] nope');
	await p.keyboard.press('Enter');
	if ((await res).status() !== 403) throw new Error(`expected 403, got ${(await res).status()}`);
	await p.waitForSelector(`.toast.error:has-text("You don't have permission")`);
	if ((await p.locator('aside.detail h2').textContent()) !== before) throw new Error('title not rolled back');
});

step('Escape in the title editor cancels without saving (review M1)', async (p) => {
	await p.waitForSelector('aside.detail article');
	const title = await p.locator('aside.detail h2').textContent();
	const before = await writes();
	await p.click('aside.detail h2 button');
	await p.fill('aside.detail textarea.title-input', 'ESCAPED TITLE');
	await p.keyboard.press('Escape');
	await p.waitForTimeout(600);
	if ((await writes()) !== before) throw new Error('Escape sent a write to GitLab');
	if ((await p.locator('aside.detail h2').textContent()) !== title) throw new Error('title changed after Escape');
});

step('edit the description in the side panel: full Markdown loads, Ctrl+Enter saves', async (p) => {
	await p.waitForSelector('aside.detail article');
	await p.click('aside.detail button:has-text("description")');
	const ta = p.locator('aside.detail textarea[aria-label^="Description"]');
	await ta.waitFor();
	const before = await writes();
	await ta.fill(`${await ta.inputValue()}\n\nEdited by the smoke test.`);
	await p.keyboard.press('Control+Enter');
	await p.waitForSelector('.toast:has-text("Description saved")');
	if ((await writes()) !== before + 1) throw new Error('description save did not reach GitLab');
	await p.waitForSelector('aside.detail :text("Edited by the smoke test.")');
});

step('comments: the panel lists them, a new comment and a reply are saved', async (p) => {
	await p.waitForSelector('aside.detail section[aria-label="Comments"]');
	await p.waitForSelector('aside.detail section[aria-label="Comments"] :text-matches("No comments yet|Reply")');
	const before = await writes();
	const box = p.locator('aside.detail textarea[aria-label="New comment"]');
	await box.fill('/close\nCommented by the smoke test.');
	await p.keyboard.press('Control+Enter');
	await p.waitForSelector('aside.detail .comment :text("Commented by the smoke test.")');
	if ((await writes()) !== before + 1) throw new Error('comment did not reach GitLab');
	// Sent to GitLab as "\/close" (neutralized, so GitLab shows it instead of running it); shown here as "/close"
	await p.locator('aside.detail .comment .body', { hasText: /^\s*\/close\s*Commented by the smoke test\.\s*$/ }).waitFor();
	if ((await box.inputValue()) !== '') throw new Error('comment box not cleared after saving');
	const thread = p.locator('aside.detail .thread', { hasText: 'Commented by the smoke test.' });
	await thread.locator('button', { hasText: 'Reply' }).click();
	await thread.locator('textarea[aria-label="Reply"]').fill('Replied by the smoke test.');
	await thread.locator('button.primary', { hasText: 'Reply' }).click();
	await thread.locator('.replies :text("Replied by the smoke test.")').waitFor();
	if ((await writes()) !== before + 2) throw new Error('reply did not reach GitLab');
	// Markdown renders; HTML and unsafe links in the text are dropped
	const xss = '**bold** and `code` [docs](https://example.com) [bad](javascript:alert(1))\n<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b onclick="window.__xss=3">b</b>';
	await box.fill(xss);
	await p.keyboard.press('Control+Enter');
	const md = p.locator('aside.detail .comment .body', { hasText: 'and' }).last();
	await md.locator('strong', { hasText: 'bold' }).waitFor();
	await md.locator('code', { hasText: 'code' }).waitFor();
	const docs = md.locator('a', { hasText: 'docs' });
	if (!(await docs.getAttribute('href'))?.startsWith('https://example.com') || (await docs.getAttribute('target')) !== '_blank' || !(await docs.getAttribute('rel'))?.includes('noopener'))
		throw new Error('a Markdown link is not a safe new-tab link');
	if ((await md.locator('a', { hasText: 'bad' }).getAttribute('href')) !== null) throw new Error('a javascript: link survived');
	if (await md.locator('img, script, [onclick], [onerror]').count()) throw new Error('unsafe HTML survived sanitizing');
	if (await p.evaluate(() => window.__xss)) throw new Error('script ran from a comment');
	// Edit my own comment
	const mine = p.locator('aside.detail .comment', { hasText: 'Replied by the smoke test.' });
	await mine.hover();
	await mine.locator('button', { hasText: 'Edit' }).click();
	const editBox = p.locator('aside.detail textarea[aria-label="Edit comment"]');
	if ((await editBox.inputValue()) !== 'Replied by the smoke test.') throw new Error('the editor did not start from the comment text');
	await editBox.fill('Replied, then edited, by the smoke test.');
	await p.keyboard.press('Control+Enter');
	await p.locator('aside.detail .comment', { hasText: 'Replied, then edited, by the smoke test.' }).locator('.edited').waitFor();
	if ((await writes()) !== before + 4) throw new Error('edit did not reach GitLab');
	// Delete it, after the confirmation
	const edited = p.locator('aside.detail .comment', { hasText: 'Replied, then edited' });
	await edited.hover();
	await edited.locator('button', { hasText: 'Delete' }).click();
	await p.locator('[role="alertdialog"] button', { hasText: 'Delete comment' }).click();
	await p.waitForSelector('.toast:has-text("Comment deleted")');
	if (await p.locator('aside.detail .comment', { hasText: 'Replied, then edited' }).count()) throw new Error('deleted comment still shown');
	if ((await writes()) !== before + 5) throw new Error('delete did not reach GitLab');
	// Esc in the comment box leaves the box, not the panel
	await box.focus();
	await p.keyboard.press('Escape');
	await p.waitForSelector('aside.detail article');
});

step("comments by others: no Edit/Delete; internal notes marked; the kiosk reads them without internal notes", async (p, ctx, browser) => {
	const n = await itemWithSeededComments();
	await open(p, `/issue/${n}`);
	const others = p.locator('section[aria-label="Comments"] .comment', { hasText: 'split this into two smaller pieces' });
	await others.waitFor();
	await others.hover();
	if (await others.locator('button', { hasText: 'Edit' }).count()) throw new Error("someone else's comment offers Edit");
	await p.locator('section[aria-label="Comments"] .comment', { hasText: 'enterprise plan' }).locator('.internal').waitFor();
	const k = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const kp = await k.newPage();
	await kp.goto(BASE + '/kiosk/' + (process.env.KIOSK_KEY || 'fake-kiosk-key-0123456789abcdef'));
	await kp.waitForSelector('html[data-ready]');
	await kp.goto(BASE + `/issue/${n}`);
	await kp.locator('section[aria-label="Comments"] .comment', { hasText: 'split this into two smaller pieces' }).waitFor();
	if (await kp.locator('section[aria-label="Comments"] :text("enterprise plan")').count()) throw new Error('the kiosk shows an internal note');
	if (await kp.locator('section[aria-label="Comments"] textarea, section[aria-label="Comments"] button:has-text("Reply")').count())
		throw new Error('the kiosk offers to comment');
	const res = await kp.request.post(BASE + '/api/items/comments', {
		headers: { origin: BASE, 'content-type': 'application/json' },
		data: { itemId: `gid://gitlab/WorkItem/${n}`, body: 'from the kiosk' }
	});
	if (res.status() !== 403) throw new Error(`kiosk comment got ${res.status()}`);
	await k.close();
	await open(p, '/v/my-issues');
	await p.locator('.row .hit').first().click();
});

step('create issue (c) prefilled and opened, with Priority and Effort set in the dialog', async (p) => {
	const before = await writes();
	await p.keyboard.press('Escape');
	await p.locator('main').click({ position: { x: 5, y: 5 } });
	await p.keyboard.press('c');
	await p.waitForSelector('dialog.create input.title');
	await p.fill('dialog.create input.title', 'Created by the smoke test');
	const pick = async (name) => {
		const sel = p.locator(`dialog.create label:has-text("${name}") select`);
		await sel.waitFor();
		const label = (await sel.locator('option').nth(1).textContent()).trim();
		await sel.selectOption({ index: 1 });
		return label;
	};
	const prio = await pick('Priority');
	const effort = await pick('Effort');
	await p.click('dialog.create button.primary');
	await p.waitForSelector('.toast:has-text("Created")');
	if ((await writes()) !== before + 1) throw new Error('create did not reach GitLab');
	const panel = p.locator('aside.detail article');
	await panel.waitFor();
	for (const [name, label] of [['Priority', prio], ['Effort', effort]]) {
		const dd = panel.locator('dt', { hasText: name }).locator('xpath=following-sibling::dd[1]');
		if (!((await dd.textContent()) ?? '').includes(label)) throw new Error(`${name} "${label}" was not set on create`);
	}
});

step('delete: Cancel and Esc in the confirmation delete nothing', async (p) => {
	// The issue created in the previous step is open in the panel.
	await p.waitForSelector('aside.detail h2:has-text("Created by the smoke test")');
	const before = await writes();
	await p.click('aside.detail button:has-text("Delete issue…")');
	await p.waitForSelector('[role="alertdialog"]:has-text("can\'t be undone")');
	const focused = await p.evaluate(() => document.activeElement?.textContent?.trim());
	if (focused !== 'Cancel') throw new Error(`focus starts on "${focused}", not Cancel`);
	await p.click('[role="alertdialog"] button:has-text("Cancel")');
	await p.waitForSelector('[role="alertdialog"]', { state: 'detached' });
	await p.click('aside.detail button:has-text("Delete issue…")');
	await p.waitForSelector('[role="alertdialog"]');
	await p.keyboard.press('Escape');
	await p.waitForSelector('[role="alertdialog"]', { state: 'detached' });
	await p.waitForTimeout(300);
	if ((await writes()) !== before) throw new Error('cancelling sent a write to GitLab');
	await p.waitForSelector('aside.detail h2:has-text("Created by the smoke test")');
});

step('delete an issue through the panel’s confirmation', async (p) => {
	const before = await writes();
	await p.click('aside.detail button:has-text("Delete issue…")');
	await p.click('[role="alertdialog"] button.danger');
	await p.waitForSelector('.toast:has-text("Deleted")');
	await p.waitForSelector('[role="alertdialog"]', { state: 'detached' });
	if (await p.locator('aside.detail').count()) throw new Error('the panel of the deleted issue is still open');
	if (await p.locator('text=Created by the smoke test').count()) throw new Error('the deleted issue is still on the board');
	if ((await writes()) !== before + 1) throw new Error('delete did not reach GitLab once');
	// Not back after a reload either: GitLab (and the server cache) no longer have it.
	await p.reload();
	await p.waitForSelector('html[data-ready]');
	await p.waitForSelector('.list .row');
	if (await p.locator('text=Created by the smoke test').count()) throw new Error('the deleted issue came back after a reload');
});

step('board: drag a card to another column saves the status', async (p) => {
	await open(p, '/v/active');
	await p.waitForSelector('.card');
	const before = await writes();
	const src = p.locator('.cell[aria-label="To do"] .card').first();
	const ref = await src.locator('.ref').textContent();
	// A stepped mouse drag (Chromium starts native HTML5 drag-and-drop from real mouse moves).
	const a = await src.boundingBox();
	const t = await p.locator('.cell[aria-label="In progress"]').boundingBox();
	await p.mouse.move(a.x + 40, a.y + 20);
	await p.mouse.down();
	for (let i = 1; i <= 10; i++) await p.mouse.move(a.x + 40 + ((t.x + 60 - a.x - 40) * i) / 10, a.y + 20 + ((t.y + 40 - a.y - 20) * i) / 10);
	await p.mouse.up();
	await p.waitForSelector(`.cell[aria-label="In progress"] .card:has(.ref:text-is("${ref}"))`);
	for (let i = 0; i < 20 && (await writes()) === before; i++) await p.waitForTimeout(150);
	if ((await writes()) !== before + 1) throw new Error('drag did not reach GitLab');
});

step('board: Alt+Arrow moves the focused card (keyboard alternative)', async (p) => {
	const before = await writes();
	const card = p.locator('.cell[aria-label="In progress"] .card').first();
	const ref = await card.locator('.ref').textContent();
	await card.focus();
	await p.keyboard.press('Alt+ArrowRight');
	await p.waitForSelector(`.cell[aria-label="Blocked"] .card:has(.ref:text-is("${ref}"))`);
	for (let i = 0; i < 20 && (await writes()) === before; i++) await p.waitForTimeout(150);
	if ((await writes()) !== before + 1) throw new Error('keyboard move did not reach GitLab');
});

step('epics: list with progress and an epic page with its issues', async (p) => {
	await open(p, '/epics');
	await p.waitForSelector('[role="progressbar"]');
	await p.locator('a.tr').first().click();
	await p.waitForURL(/\/epics\/\d+/);
	await p.waitForSelector('.list .row');
});

step('command palette jumps to a view', async (p) => {
	await p.keyboard.press('Escape');
	await p.keyboard.press('Control+k');
	await p.waitForSelector('[aria-label="Command palette"] input');
	await p.keyboard.type('by priority');
	await p.keyboard.press('Enter');
	await p.waitForURL('**/v/by-priority');
});

step('save a modified view and find it after reload', async (p) => {
	await open(p, '/v/my-issues');
	await p.click('button:has-text("Display")');
	await p.locator('[aria-label="Display options"] select').first().selectOption({ label: 'Priority' });
	await p.keyboard.press('Escape');
	await p.waitForURL('**?v=*');
	await p.click('button:has-text("Save as new view")');
	await p.waitForURL(/\/v\/u-/);
	await p.reload();
	await p.waitForSelector('nav >> text=My issues (copy)');
});

step('a cross-origin write is refused', async (p) => {
	const res = await p.request.post(BASE + '/api/items/update', {
		headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
		data: { itemId: 'gid://gitlab/WorkItem/2000', field: 'native:weight', value: 1 }
	});
	if (res.status() !== 403) throw new Error(`cross-origin write got ${res.status()}`);
});

step('Prioritization section: priority × effort renders (no Eisenhower), Display is hidden, views have no Matrix', async (p) => {
	await open(p, '/');
	const nav = p.locator('nav[aria-label="Board navigation"]');
	await nav.locator('h2', { hasText: 'Prioritization' }).waitFor();
	if (await nav.locator('a[href="/p/standup"]').count()) throw new Error('the Eisenhower tool is still listed');
	await nav.locator('a[href="/p/priority-effort"]').click();
	await p.waitForURL('**/p/priority-effort');
	await p.waitForSelector('text=Quick wins');
	if (await p.locator('button:has-text("Display")').count()) throw new Error('tool page shows the Display menu');
	await open(p, '/v/my-issues');
	await p.click('button:has-text("Display")');
	if (await p.locator('[aria-label="Layout"] button', { hasText: 'Matrix' }).count()) throw new Error('views still offer a Matrix layout');
	await p.keyboard.press('Escape');
});

step('the sidebar hides completely and comes back (button, tab, [ key, remembered)', async (p) => {
	await open(p, '/p/priority-effort');
	const width = () => p.$eval('main.main', (m) => m.getBoundingClientRect().width);
	const before = await width();
	await p.click('button[aria-label="Hide sidebar"]');
	await p.waitForSelector('button[aria-label="Show sidebar"]');
	if ((await width()) <= before) throw new Error('hiding the sidebar did not widen the content');
	await p.reload();
	await p.waitForSelector('html[data-ready]');
	if (!(await p.locator('button[aria-label="Show sidebar"]').count())) throw new Error('hidden sidebar not remembered');
	await p.keyboard.press('[');
	await p.waitForSelector('button[aria-label="Hide sidebar"]');
	await p.keyboard.press('[');
	await p.click('button[aria-label="Show sidebar"]');
	await p.locator('nav a[href="/v/my-issues"]').waitFor();
});

step('full issue page: open from the panel, links, Esc back, sub-issues, not found', async (p) => {
	const path = () => new URL(p.url()).pathname;
	await open(p, '/v/my-issues');
	await p.locator('.row .hit').first().click();
	await p.waitForSelector('aside.detail article');
	if (new URL(p.url()).search) throw new Error(`the side panel changed the URL: ${p.url()}`);
	// Panel → full page; the side panel stays closed for it
	await p.click('aside.detail a[aria-label="Open as page"]');
	await p.waitForURL(/\/issue\/\d+$/);
	await p.waitForSelector('article.page');
	const issueUrl = path();
	if (await p.locator('aside.detail').count()) throw new Error('side panel shown next to the full page');
	// Shortcuts act on the page's item: S opens the status editor in Properties
	await p.keyboard.press('s');
	await p.waitForSelector('aside.props [role="dialog"], aside.props [role="listbox"]');
	await p.keyboard.press('Escape');
	if (await p.locator('aside.detail').count()) throw new Error('S opened the side panel');
	// The ••• menu has the item actions; the Properties column can be hidden and comes back
	await p.click('button[title="More actions"]');
	await p.waitForSelector('[role="dialog"] >> text=Copy ID');
	await p.keyboard.press('Escape');
	await p.click('button[aria-label="Hide properties"]');
	await p.waitForSelector('aside.props', { state: 'detached' });
	await p.click('button[aria-label="Show properties"]');
	await p.waitForSelector('aside.props');
	// Parent link → the parent's page; Esc goes back, twice back to the list
	const crumb = p.locator('article.page a.crumb').first();
	if (await crumb.count()) {
		await crumb.click();
		await p.waitForFunction((u) => location.pathname !== u, issueUrl);
		await p.waitForSelector('article.page h3:has-text("Child items")');
		if (!(await p.locator(`article.page a.child[href="${issueUrl}"]`).count())) throw new Error('parent page does not list the issue as a sub-issue');
		await p.keyboard.press('Escape');
		await p.waitForFunction((u) => location.pathname === u, issueUrl);
		await p.waitForSelector('article.page a.crumb'); // the issue's page is back (the epic has no parent)
	}
	await p.keyboard.press('Escape');
	await p.waitForURL('**/v/my-issues');
	// A link opened fresh: with ?sidebar=hidden, and Esc goes home (keeping the sidebar param)
	await open(p, issueUrl + '?sidebar=hidden');
	await p.waitForSelector('article.page');
	await p.waitForSelector('button[aria-label="Show sidebar"]');
	await p.keyboard.press('Escape');
	await p.waitForFunction((u) => location.pathname !== u, issueUrl);
	if (new URL(p.url()).searchParams.get('sidebar') !== 'hidden') throw new Error(`?sidebar=hidden lost going home: ${p.url()}`);
	await p.click('button[aria-label="Show sidebar"]');
	// Unknown item; the old ?issue= param does nothing
	await open(p, '/issue/999999');
	await p.waitForSelector('text=Issue not found');
	await open(p, '/v/my-issues?issue=' + issueUrl.split('/').pop());
	await p.waitForSelector('.list .row');
	await p.waitForTimeout(200);
	if (await p.locator('aside.detail').count()) throw new Error('?issue= still opens the panel');
});

step("child items follow GitLab's hierarchy: epic → epic | issue, issue → task", async (p) => {
	// An epic offers epics and issues
	await open(p, '/epics');
	await p.locator('a[href^="/epics/"]').first().waitFor();
	const epicId = (await p.locator('a[href^="/epics/"]').first().getAttribute('href')).split('/').pop();
	await open(p, `/issue/${epicId}`);
	await p.waitForSelector('article.page');
	await p.locator('article.page button:has-text("+ Add child item")').click();
	const kinds = await p.locator('[role="dialog"] .menu-item').allInnerTexts();
	if (kinds.join() !== 'Epic,Issue') throw new Error(`epic offers ${kinds}`);
	await p.keyboard.press('Escape');
	// An issue offers tasks: "New task" with the issue as parent, and only issues as possible parents
	await open(p, '/v/my-issues');
	await p.locator('.row .hit').first().click();
	await p.click('aside.detail a[aria-label="Open as page"]');
	await p.waitForSelector('article.page');
	const issueId = new URL(p.url()).pathname.split('/').pop();
	await p.locator('article.page button:has-text("+ Add task")').click();
	await p.waitForSelector('dialog[open] >> text=New task');
	const parent = p.locator('dialog[open] select').last();
	if ((await parent.inputValue()) !== `gid://gitlab/WorkItem/${issueId}`) throw new Error('task not preset under its issue');
	const epicTitle = await p.evaluate(async (id) => (await (await fetch('/api/board')).json()).board.items.find((i) => i.id.endsWith('/' + id))?.title, epicId);
	if (epicTitle && (await parent.locator('option', { hasText: epicTitle }).count())) throw new Error('an epic is offered as a task parent');
	await p.keyboard.press('Escape');
	await p.waitForSelector('dialog[open]', { state: 'detached' });
});

step('?sidebar=hidden hides the sidebar and stays until you show it', async (p) => {
	const q = () => new URL(p.url()).searchParams;
	const has = (name, value) =>
		p.waitForFunction(([n, v]) => {
			const got = new URL(location.href).searchParams.get(n);
			return v === undefined ? got === null : v === '*' ? got !== null : got === v;
		}, [name, value]);
	// Toggling the sidebar never writes it into the URL
	await open(p, '/v/my-issues');
	await p.keyboard.press('[');
	await p.waitForSelector('button[aria-label="Show sidebar"]');
	await p.waitForTimeout(200);
	if (q().has('sidebar')) throw new Error('toggling the sidebar put it in the URL');
	await p.keyboard.press('[');
	await p.waitForSelector('button[aria-label="Hide sidebar"]');
	// With the param: hidden, and kept through a view change (?v=) and a reload
	await open(p, '/v/my-issues?sidebar=hidden');
	await p.waitForSelector('button[aria-label="Show sidebar"]');
	await p.click('button:has-text("Display")');
	await p.click('[aria-label="Layout"] button:has-text("Board")');
	await has('v', '*');
	if (q().get('sidebar') !== 'hidden') throw new Error(`view change dropped ?sidebar=hidden: ${p.url()}`);
	await p.keyboard.press('Escape'); // close the Display popover
	await p.reload();
	await p.waitForSelector('html[data-ready]');
	await p.waitForSelector('button[aria-label="Show sidebar"]');
	// The epics list writes its own query string and must keep it
	await open(p, '/epics?sidebar=hidden');
	await p.locator('input[type="search"], input[placeholder*="Search" i]').first().fill('x');
	await has('q', 'x');
	if (q().get('sidebar') !== 'hidden') throw new Error(`epics dropped ?sidebar=hidden: ${p.url()}`);
	// Showing the sidebar yourself drops the param; hiding it again doesn't bring it back
	await p.keyboard.press('Escape');
	await p.click('button[aria-label="Show sidebar"]');
	await has('sidebar', undefined);
	await p.keyboard.press('[');
	await p.waitForSelector('button[aria-label="Show sidebar"]');
	await p.waitForTimeout(200);
	if (q().has('sidebar')) throw new Error('toggling the sidebar put it back in the URL');
	await p.keyboard.press('['); // shown again, as the steps after this expect
});

step('an old matrix share link opens as a list with a notice', async (p) => {
	const LZ = require('lz-string');
	const old = {
		version: 1, id: 'old', name: 'Old matrix', layout: 'matrix',
		filter: { op: 'and', rules: [] }, orderBy: [],
		display: { properties: [], subIssues: 'flat', showEmptyGroups: false, completed: 'none' },
		matrix: { x: { field: { field: 'native:weight' } }, y: { field: { name: 'Priority' } } }
	};
	await open(p, '/v/shared?v=' + LZ.compressToEncodedURIComponent(JSON.stringify(old)));
	await p.waitForSelector('text=moved to Prioritization');
	if (await p.locator('[aria-label="Value vs effort matrix"]').count()) throw new Error('old link still drew a matrix');
});

step('the kiosk shows config views and cannot write', async (p, ctx, browser) => {
	const k = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const kp = await k.newPage();
	await kp.goto(BASE + '/kiosk/' + (process.env.KIOSK_KEY || 'fake-kiosk-key-0123456789abcdef') + '?sidebar=hidden');
	await kp.waitForSelector('html[data-ready]');
	// ?sidebar=hidden is passed through the kiosk redirect and survives a reload
	if (new URL(kp.url()).search !== '?sidebar=hidden') throw new Error(`kiosk redirect lost ?sidebar=hidden: ${kp.url()}`);
	await kp.waitForSelector('button[aria-label="Show sidebar"]');
	await kp.reload();
	await kp.waitForSelector('html[data-ready]');
	await kp.waitForSelector('button[aria-label="Show sidebar"]');
	await kp.click('button[aria-label="Show sidebar"]');
	await kp.waitForSelector('text=Kiosk · read-only');
	// KIOSK_VIEWS lists "priority-effort" (a prioritization tool) first, so "/" opens it
	if (process.env.KIOSK_VIEWS?.startsWith('priority-effort')) await kp.waitForSelector('[aria-label="Value vs effort matrix"]');
	if (await kp.locator('text=New issue').count()) throw new Error('kiosk offers "New issue"');
	const res = await kp.request.post(BASE + '/api/items/update', {
		headers: { origin: BASE, 'content-type': 'application/json' },
		data: { itemId: 'gid://gitlab/WorkItem/2000', field: 'native:weight', value: 1 }
	});
	if (res.status() !== 403) throw new Error(`kiosk write got ${res.status()}`);
	const del = await kp.request.post(BASE + '/api/items/delete', {
		headers: { origin: BASE, 'content-type': 'application/json' },
		data: { itemId: 'gid://gitlab/WorkItem/2000' }
	});
	if (del.status() !== 403) throw new Error(`kiosk delete got ${del.status()}`);
	await k.close();
});

(async () => {
	const browser = await chromium.launch();
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const p = await ctx.newPage();
	p.setDefaultTimeout(8000);
	const errors = [];
	p.on('pageerror', (e) => errors.push(e.message));
	if (process.env.SMOKE_DEBUG) {
		p.on('console', (m) => console.log('  console:', m.text().slice(0, 300)));
		p.on('crash', () => console.log('  PAGE CRASHED'));
	}
	let failed = 0;
	for (const s of steps) {
		if (only.length && !only.some((o) => s.name.includes(o)) && !s.name.startsWith('sign in')) continue;
		const t = Date.now();
		try {
			await s.fn(p, ctx, browser);
			console.log(`✓ ${s.name} (${Date.now() - t} ms)`);
		} catch (err) {
			failed++;
			console.log(`✗ ${s.name}: ${err.message.split('\n')[0]}`);
			console.log(`    at ${p.url()}`);
			await p.screenshot({ path: `smoke-failure-${steps.indexOf(s)}.png` }).catch(() => {});
		}
	}
	if (errors.length) {
		failed++;
		console.log('✗ page errors:', errors);
	}
	await browser.close();
	console.log(failed ? `${failed} failed` : 'all passed');
	process.exit(failed ? 1 : 0);
})();
