// Quick screenshot helper: node tests/shot.cjs <path> <out.png> [dark] [width] [height]
const { chromium } = require('playwright');
(async () => {
	const [path = '/', out = 'shot.png', theme = 'light', w = '1440', h = '900'] = process.argv.slice(2);
	const base = process.env.BOARD_URL || 'http://localhost:5173';
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: theme === 'dark' ? 'dark' : 'light' });
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
	await page.goto(base + '/signin');
	await page.click('text=Sign in with GitLab');
	await page.waitForLoadState('networkidle');
	await page.goto(base + path);
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(500);
	await page.screenshot({ path: out, fullPage: false });
	console.log('url', page.url(), 'errors', JSON.stringify(errors));
	await browser.close();
})();
