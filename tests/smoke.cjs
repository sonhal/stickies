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

async function writes() {
	return (await (await fetch(`${FAKE}/__writes`)).json()).writes;
}

step('sign in through OAuth', async (p) => {
	await p.goto(BASE + '/');
	await p.waitForURL('**/signin**');
	await p.click('text=Sign in with GitLab');
	await p.waitForSelector('nav[aria-label="Board navigation"]');
});

step('matrix (standup) renders quadrants and the walk-through', async (p) => {
	await open(p, '/p/standup');
	await p.waitForSelector('[aria-label="Eisenhower matrix"]');
	if ((await p.locator('.note').count()) < 5) throw new Error('too few notes');
	await p.keyboard.press('ArrowRight');
	await p.waitForSelector('.note.selected');
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

step('create issue (c) prefilled and opened', async (p) => {
	const before = await writes();
	await p.keyboard.press('Escape');
	await p.locator('main').click({ position: { x: 5, y: 5 } });
	await p.keyboard.press('c');
	await p.waitForSelector('dialog.create input.title');
	await p.fill('dialog.create input.title', 'Created by the smoke test');
	await p.click('dialog.create button.primary');
	await p.waitForSelector('.toast:has-text("Created")');
	if ((await writes()) !== before + 1) throw new Error('create did not reach GitLab');
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

step('Prioritization section: both tools render, Display is hidden, views have no Matrix', async (p) => {
	await open(p, '/');
	const nav = p.locator('nav[aria-label="Board navigation"]');
	await nav.locator('h2', { hasText: 'Prioritization' }).waitFor();
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
	await open(p, '/p/standup');
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

step('the URL keeps the open issue and the sidebar (?issue=, ?sidebar=)', async (p) => {
	const q = () => new URL(p.url()).searchParams;
	const has = (name, value) =>
		p.waitForFunction(([n, v]) => {
			const got = new URL(location.href).searchParams.get(n);
			return v === undefined ? got === null : v === '*' ? got !== null : got === v;
		}, [name, value]);
	// Opening an item puts it in the address bar; closing takes it out
	await open(p, '/v/my-issues');
	await p.locator('.row .hit').first().click();
	await has('issue', '*');
	const id = q().get('issue');
	await p.click('aside.detail button[aria-label="Close panel (Esc)"]');
	await has('issue', undefined);
	// A link straight to an issue, with the sidebar hidden
	await open(p, `/v/my-issues?issue=${id}&sidebar=hidden`);
	await p.waitForSelector('aside.detail article');
	await p.waitForSelector('button[aria-label="Show sidebar"]');
	// The sidebar toggle follows too
	await p.keyboard.press('[');
	await has('sidebar', undefined);
	await p.keyboard.press('[');
	await has('sidebar', 'hidden');
	// A view change (?v=) keeps both
	await p.click('button:has-text("Display")');
	await p.click('[aria-label="Layout"] button:has-text("Board")');
	await has('v', '*');
	if (q().get('issue') !== id || q().get('sidebar') !== 'hidden') throw new Error(`view change dropped shell params: ${p.url()}`);
	await p.keyboard.press('Escape'); // close the Display popover
	// Reload shows the same thing
	const url = p.url();
	await p.reload();
	await p.waitForSelector('html[data-ready]');
	await p.waitForSelector('aside.detail article');
	await p.waitForSelector('button[aria-label="Show sidebar"]');
	if (p.url() !== url) throw new Error(`reload changed the URL: ${url} → ${p.url()}`);
	// An unknown issue says so; ?sidebar=shown overrides a hidden preference
	await open(p, '/v/my-issues?issue=999999&sidebar=shown');
	await p.waitForSelector("text=That issue isn't on the board");
	await p.waitForSelector('button[aria-label="Hide sidebar"]');
	if (await p.locator('aside.detail article').count()) throw new Error('panel opened for an unknown issue');
	// The epics list writes its own query string and must keep ours
	await open(p, `/epics?sidebar=hidden&issue=${id}`);
	await p.waitForSelector('aside.detail article');
	await p.locator('input[type="search"], input[placeholder*="Search" i]').first().fill('x');
	await has('q', 'x');
	if (q().get('sidebar') !== 'hidden' || q().get('issue') !== id) throw new Error(`epics dropped shell params: ${p.url()}`);
	// Leave things as the steps after this one expect
	await p.keyboard.press('Escape');
	await p.click('button[aria-label="Show sidebar"]');
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
	if (await p.locator('[aria-label="Eisenhower matrix"]').count()) throw new Error('old link still drew a matrix');
});

step('the kiosk shows config views and cannot write', async (p, ctx, browser) => {
	const k = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	const kp = await k.newPage();
	await kp.goto(BASE + '/kiosk/' + (process.env.KIOSK_KEY || 'fake-kiosk-key-0123456789abcdef'));
	await kp.waitForSelector('text=Kiosk · read-only');
	// KIOSK_VIEWS lists "standup" (a prioritization tool) first, so "/" opens it
	if (process.env.KIOSK_VIEWS?.startsWith('standup')) await kp.waitForSelector('[aria-label="Eisenhower matrix"]');
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
