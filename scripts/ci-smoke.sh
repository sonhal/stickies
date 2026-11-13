#!/usr/bin/env bash
# Runs the Playwright smoke test the way CI does: fake GitLab + the built board, then tests/smoke.cjs.
# Needs `npm run build` first, and the `playwright` package with Chromium (the CI image has both).
#   bash scripts/ci-smoke.sh
set -euo pipefail
cd "$(dirname "$0")/.."

FAKE_PORT="${FAKE_GITLAB_PORT:-4010}"
BOARD_PORT="${BOARD_PORT:-3000}"

# The board's settings for the fake GitLab (OAuth client, session secret, kiosk key)
. scripts/dev-env.sh
export GITLAB_URL="http://localhost:${FAKE_PORT}"

[ -f build/index.js ] || { echo "No build/ found: run npm run build first" >&2; exit 1; }

FAKE_GITLAB_PORT="$FAKE_PORT" node scripts/fake-gitlab.mjs > fake-gitlab.log 2>&1 &
ORIGIN="http://localhost:${BOARD_PORT}" PORT="$BOARD_PORT" node build > board.log 2>&1 &
trap 'kill $(jobs -p) 2>/dev/null || true' EXIT

# Wait until both answer (up to 30 s), so a slow runner doesn't fail the first step
node -e '
const urls = process.argv.slice(1);
const until = Date.now() + 30_000;
(async () => {
	for (const u of urls) {
		for (;;) {
			try { await fetch(u); break; } catch {}
			if (Date.now() > until) { console.error("Not up in time: " + u); process.exit(1); }
			await new Promise((r) => setTimeout(r, 300));
		}
	}
})();
' "http://localhost:${FAKE_PORT}/api/v4/version" "http://localhost:${BOARD_PORT}/signin"

BOARD_URL="http://localhost:${BOARD_PORT}" FAKE_GITLAB_URL="http://localhost:${FAKE_PORT}" node tests/smoke.cjs
