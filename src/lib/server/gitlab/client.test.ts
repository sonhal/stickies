import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetGroupPaths, groupLabelFor, groupPath, GitLabError } from './client';
import type { ServerConfig } from '../config';

const cfg = (group: string) => ({ gitlabUrl: 'https://gitlab.example.com', group }) as ServerConfig;
const cred = { kind: 'oauth' as const, token: 't' };
const reply = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }));

afterEach(() => {
	vi.unstubAllGlobals();
	_resetGroupPaths();
});

describe('groupPath: numeric GITLAB_GROUP (review M6)', () => {
	it('passes a path through without calling GitLab', async () => {
		const f = reply(200, {});
		vi.stubGlobal('fetch', f);
		expect(await groupPath(cfg('acme/platform'), cred)).toBe('acme/platform');
		expect(f).not.toHaveBeenCalled();
	});

	it('resolves an id once via REST, with the viewer token, and remembers it', async () => {
		const f = reply(200, { id: 1234567, full_path: 'acme/platform' });
		vi.stubGlobal('fetch', f);
		expect(await groupPath(cfg('1234567'), cred)).toBe('acme/platform');
		expect(await groupPath(cfg('1234567'), cred)).toBe('acme/platform');
		expect(f).toHaveBeenCalledTimes(1);
		const [url, init] = f.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
		expect(url).toBe('https://gitlab.example.com/api/v4/groups/1234567?with_projects=false');
		expect(init.headers.Authorization).toBe('Bearer t');
		expect(groupLabelFor(cfg('1234567'))).toBe('acme/platform');
	});

	it('reports a group the viewer cannot see as not found, and does not remember it', async () => {
		vi.stubGlobal('fetch', reply(404, { message: '404 Group Not Found' }));
		await expect(groupPath(cfg('42'), cred)).rejects.toMatchObject({ status: 404 });
		vi.stubGlobal('fetch', reply(200, { full_path: 'acme/platform' }));
		expect(await groupPath(cfg('42'), cred)).toBe('acme/platform');
	});

	it('refuses a strange path from GitLab instead of putting it in a query', async () => {
		vi.stubGlobal('fetch', reply(200, { full_path: 'acme/platform") { evil }' }));
		await expect(groupPath(cfg('7'), cred)).rejects.toBeInstanceOf(GitLabError);
	});
});
