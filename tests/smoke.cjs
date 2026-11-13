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

step('inline edit: weight via keyboard (w) is saved as a number', async (p) => {
	await open(p, '/v/my-issues');
	await p.locator('.row .hit').first().click();
	await p.waitForSelector('aside.detail article');
	const before = await writes();
	await p.keyboard.press('w');
	await p.locator('aside.detail input[type="number"]').fill('7');
	await p.keyboard.press('Enter');
	for (let i = 0; i < 20 && (await writes()) === before; i++) await p.waitForTimeout(150);
	if ((await writes()) !== before + 1) throw new Error('no write reached GitLab');
	const ref = (await p.locator('aside.detail .ref').innerText()).trim();
	const w = await p.evaluate(async (r) => (await (await fetch('/api/board')).json()).board.items.find((i) => i.ref === r)?.values['native:weight'], ref);
	if (w?.value !== 7) throw new Error(`weight is ${JSON.stringify(w)}`);
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
	if (await p.locator('[aria-label="Eisenhower matrix"]').count()) throw new Error('old link still drew a matrix');
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
