/**
 * Screenshots for docs/screenshots/, against scripts/fake-gitlab.mjs (fresh data).
 *   BOARD_URL=http://localhost:3000 node tests/screenshots.cjs
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = process.env.BOARD_URL || 'http://localhost:5173';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

async function shoot(browser, theme) {
	const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: theme, deviceScaleFactor: 1 });
	const p = await ctx.newPage();
	p.setDefaultTimeout(8000);
	const go = async (u) => {
		await p.goto(BASE + u);
		await p.waitForSelector('html[data-ready]');
		await p.waitForTimeout(300);
	};
	const snap = (name) => p.screenshot({ path: path.join(OUT, `${name}-${theme}.png`) });

	await p.goto(BASE + '/signin');
	await p.click('text=Sign in with GitLab');
	await p.waitForSelector('nav[aria-label="Board navigation"]');

	await go('/v/epics');
	await snap('list');

	await go('/v/my-issues');
	await p.locator('.row .hit').nth(1).click();
	await p.waitForSelector('aside.detail article');
	await p.waitForTimeout(200);
	await snap('panel');

	await go('/v/active');
	await snap('board');

	await go('/p/standup');
	await p.keyboard.press('ArrowRight');
	await p.waitForSelector('.note.selected');
	await snap('matrix');

	await go('/v/by-priority');
	await p.keyboard.press('Control+k');
	await p.keyboard.type('pay');
	await p.waitForTimeout(200);
	await snap('palette');

	await p.keyboard.press('Escape');
	await go('/epics');
	await snap('epics');
	await ctx.close();
}

(async () => {
	const browser = await chromium.launch();
	for (const theme of ['light', 'dark']) await shoot(browser, theme);
	await browser.close();
	console.log('wrote', OUT);
})();
