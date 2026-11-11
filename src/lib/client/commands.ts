/** Command palette entries and matching. Pure, so the matcher is unit-tested. */
export interface Command {
	id: string;
	group: string;
	label: string;
	hint?: string;
	/** Extra words to match on (not shown) */
	keywords?: string;
	run: () => void;
}

/** Every query word must appear; label prefix matches rank first. Returns at most `limit`. */
export function matchCommands(cmds: Command[], q: string, limit = 60): Command[] {
	const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!words.length) return cmds.slice(0, limit);
	const scored: { c: Command; s: number }[] = [];
	for (const c of cmds) {
		const hay = `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''} ${c.group}`.toLowerCase();
		if (!words.every((w) => hay.includes(w))) continue;
		const label = c.label.toLowerCase();
		const s = (label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2) + (c.group === 'Issues' ? 0.5 : 0);
		scored.push({ c, s });
	}
	return scored
		.sort((a, b) => a.s - b.s)
		.slice(0, limit)
		.map((x) => x.c);
}
