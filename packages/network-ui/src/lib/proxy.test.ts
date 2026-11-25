import { describe, expect, it, vi } from 'vitest';
import { I2P_PORT, NO_PROXY, buildProxy, editedUrl, freshId, groupId, groupsProblem, i2pProxy, i2pRule, i2pRuleIndex, isNew, move, newEntry, newGroup, parseProxy, proxiesPatch, registryProblem, shortDuration, splitDuration, toSecs } from './proxy';
import { group, settings } from '../test-helpers';

describe('proxy fields', () => {
  it('parses every kind of proxy url', () => {
    expect(parseProxy('')).toEqual(NO_PROXY);
    expect(parseProxy('not a url')).toEqual(NO_PROXY);
    expect(parseProxy('ftp://h:1').kind).toBe('none');
    expect(parseProxy('socks5://127.0.0.1:9050')).toEqual({ ...NO_PROXY, kind: 'socks5', host: '127.0.0.1', port: '9050' });
    expect(parseProxy('socks5h://tor:9050').kind).toBe('socks5');
    expect(parseProxy('https://proxy.example')).toMatchObject({ kind: 'https', port: '443' });
    expect(parseProxy('http://proxy.lan')).toMatchObject({ kind: 'http', port: '80' });
    expect(parseProxy('socks5://u%40x:***@[::1]:1080')).toMatchObject({ host: '::1', username: 'u@x', hasPassword: true, password: '' });
    expect(parseProxy('socks5://h')).toMatchObject({ port: '' });
  });

  it('builds urls and explains what is missing', () => {
    expect(buildProxy(NO_PROXY)).toEqual({ url: '' });
    const base = { ...NO_PROXY, kind: 'socks5' as const, host: ' 127.0.0.1 ', port: '9050' };
    expect(buildProxy(base)).toEqual({ url: 'socks5://127.0.0.1:9050' });
    expect(buildProxy({ ...base, host: '::1' })).toEqual({ url: 'socks5://[::1]:9050' });
    expect(buildProxy({ ...base, username: 'u@x', password: 'p:w' })).toEqual({ url: 'socks5://u%40x:p%3Aw@127.0.0.1:9050' });
    expect(buildProxy({ ...base, username: 'u' })).toEqual({ url: 'socks5://u@127.0.0.1:9050' });
    expect(buildProxy({ ...base, host: 'a b' })).toEqual({ error: expect.stringContaining('host') });
    expect(buildProxy({ ...base, port: '0' })).toEqual({ error: expect.stringContaining('port') });
    expect(buildProxy({ ...base, port: '70000' })).toEqual({ error: expect.stringContaining('port') });
    expect(buildProxy({ ...base, username: 'u', hasPassword: true })).toEqual({ error: expect.stringContaining('Re-enter') });
    expect(buildProxy({ ...base, hasPassword: true })).toEqual({ url: 'socks5://127.0.0.1:9050' });
  });

  it('keeps a hidden password only while the rest of the address is unchanged', () => {
    const old = 'socks5://me:***@10.0.0.1:1080';
    const f = parseProxy(old);
    expect(editedUrl(old, f)).toEqual({ url: old });
    expect(editedUrl(old, { ...f, port: '1081' })).toEqual({ error: expect.stringContaining('Re-enter') });
    expect(editedUrl(old, { ...f, port: '1081', password: 'x' })).toEqual({ url: 'socks5://me:x@10.0.0.1:1081' });
    expect(editedUrl('socks5://10.0.0.1:1080', parseProxy('socks5://10.0.0.1:1080'))).toEqual({ url: 'socks5://10.0.0.1:1080' });
  });
});

describe('the proxy list', () => {
  it('moves entries and ignores moves off the ends', () => {
    expect(move([1, 2, 3], 0, 1)).toEqual([2, 1, 3]);
    expect(move([1, 2, 3], 2, 0)).toEqual([3, 1, 2]);
    const same = [1, 2];
    expect(move(same, 1, 1)).toBe(same);
    expect(move(same, 0, -1)).toBe(same);
    expect(move(same, 0, 2)).toBe(same);
  });

  it('gives new entries an id the service accepts, apart from the ids taken', () => {
    const a = newEntry('x', 'socks5://h:1', false, []);
    expect(a.id).toMatch(/^p[0-9a-f]{8}$/);
    expect(isNew(a, [{ id: 'p1' }])).toBe(true);
    expect(isNew({ id: 'p1' }, [{ id: 'p1' }])).toBe(false);
    // A random id that is taken is drawn again.
    const random = vi.spyOn(crypto, 'getRandomValues');
    random.mockImplementationOnce((b) => (b as Uint8Array).fill(1)).mockImplementationOnce((b) => (b as Uint8Array).fill(2));
    expect(freshId('p', ['p01010101'])).toBe('p02020202');
  });

  it('makes a group id from its name once, unique, and random when the name has no letters', () => {
    expect(groupId('Exits', [])).toBe('exits');
    expect(groupId('  Tor & VPN!! ', [])).toBe('tor-vpn');
    expect(groupId('Exits', ['exits', 'exits-2'])).toBe('exits-3');
    expect(groupId('A very long group name that goes on', [])).toBe('a-very-long-group-na');
    expect(groupId('!!!', [])).toMatch(/^g[0-9a-f]{8}$/);
    expect(newGroup('Exits', ['a', 'b'], [])).toEqual({ id: 'exits', name: 'Exits', proxies: ['a', 'b'], strategy: 'failover', rotate_secs: 3600, chaos_min_secs: 300, chaos_max_secs: 900 });
  });

  it('splits seconds into the biggest even unit and back', () => {
    expect(splitDuration(3600)).toEqual({ n: 1, unit: 'h' });
    expect(splitDuration(900)).toEqual({ n: 15, unit: 'm' });
    expect(splitDuration(172_800)).toEqual({ n: 2, unit: 'd' });
    expect(splitDuration(90)).toEqual({ n: 90, unit: 's' });
    expect(splitDuration(0)).toEqual({ n: 0, unit: 's' });
    expect(toSecs(15, 'm')).toBe(900);
    expect(shortDuration(900)).toBe('15m');
    expect(shortDuration(5400)).toBe('90m');
    expect(shortDuration(90)).toBe('1m 30s');
    expect(shortDuration(30)).toBe('30s');
  });
});

describe('the proxy patch', () => {
  const entry = { id: 'a', name: 'tor', url: 'socks5://u:***@h:1' };
  const live = { ...settings().proxies, list: [entry, { ...entry, id: 'b', url: 'socks5://h:2' }] };

  it('is empty without changes, and names only what differs', () => {
    expect(proxiesPatch(live, structuredClone(live))).toEqual({});
    const form = { ...structuredClone(live), offline: 'open' as const, transparent: true, default: { proxy: 'a' } };
    expect(proxiesPatch(live, form)).toEqual({ offline: 'open', transparent: true, default: { proxy: 'a' } });
  });

  it('sends the whole list, every entry with its id', () => {
    const base = { ...live, list: [entry] };
    const added = newEntry('new', 'socks5://n:1', false, ['a']);
    const form = { ...base, list: [added, entry] };
    expect(proxiesPatch(base, form)).toEqual({ list: [{ id: added.id, name: 'new', url: 'socks5://n:1' }, { id: 'a', name: 'tor', url: 'socks5://u:***@h:1' }] });
  });

  it('sends the rules, groups, per-key default routes and registries whole when they change', () => {
    const rule = { name: 'I2P', match: ['*.i2p'], keys: [], to: { group: 'g' }, fallback: 'policy' as const };
    const form = { ...structuredClone(live), groups: [group('g', ['a', 'b'])], rules: [rule], default_keys: { admin: 'block' as const }, i2p_registries: [live.i2p_registries[0]] };
    expect(proxiesPatch(live, form)).toEqual({ groups: [group('g', ['a', 'b'])], rules: [rule], default_keys: { admin: 'block' }, i2p_registries: [live.i2p_registries[0]] });
    // The order of the per-key default routes does not matter.
    const both = { ...live, default_keys: { admin: 'block' as const, invoices: 'direct' as const } };
    expect(proxiesPatch(both, { ...both, default_keys: { invoices: 'direct', admin: 'block' } })).toEqual({});
  });

  it("reports a problem with a group: its proxies, its intervals, whatever the strategy", () => {
    const f = (over: Partial<ReturnType<typeof group>>) => proxiesPatch(live, { ...live, groups: [group('g', ['a', 'b'], { name: 'Exits', strategy: 'failover', ...over })] });
    expect(f({ proxies: ['a'] })).toContain('Group Exits needs at least 2 proxies');
    expect(f({ proxies: ['a', 'gone'] })).toContain('Group Exits holds a proxy that is no longer listed');
    expect(f({ rotate_secs: NaN })).toBe('Group Exits: fill in every interval.');
    expect(f({ chaos_min_secs: 10 })).toBe('Group Exits: intervals run from 1 minute to 7 days.');
    expect(f({ chaos_max_secs: 700_000 })).toBe('Group Exits: intervals run from 1 minute to 7 days.');
    expect(f({ chaos_min_secs: 900, chaos_max_secs: 300 })).toContain('longer than the longest');
    expect(groupsProblem({ list: live.list, groups: Array.from({ length: 9 }, (_, i) => group(`g${i}`, ['a', 'b'])) })).toBe('At most 8 groups.');
    expect(groupsProblem({ list: live.list, groups: [group('g', ['a', 'b'])] })).toBe('');
  });
});

describe('the I2P router proxy', () => {
  it('is an http:// proxy marked i2p', () => {
    expect(parseProxy('http://127.0.0.1:4444', true)).toMatchObject({ kind: 'i2p', port: '4444' });
    // Only an http:// proxy can be one.
    expect(parseProxy('socks5://127.0.0.1:4447', true).kind).toBe('socks5');
    expect(buildProxy({ ...NO_PROXY, kind: 'i2p', host: '127.0.0.1', port: I2P_PORT })).toEqual({ url: 'http://127.0.0.1:4444' });
    // Turning a proxy into the I2P router keeps its hidden password.
    expect(editedUrl('http://u:***@h:4444', { ...parseProxy('http://u:***@h:4444'), kind: 'i2p' })).toEqual({ url: 'http://u:***@h:4444' });
  });

  it('is sent with i2p', () => {
    const e = newEntry('i2pd', 'http://127.0.0.1:4444', true, []);
    expect(e).toMatchObject({ i2p: true });
    expect(newEntry('tor', 'socks5://h:1', false, [])).toMatchObject({ i2p: false });
    const live = settings().proxies;
    const form = { ...live, list: [e, { id: 'p1', name: '', url: 'socks5://h:1', i2p: true }] };
    expect((proxiesPatch(live, form) as { list: unknown[] }).list).toEqual([
      { id: e.id, name: 'i2pd', url: 'http://127.0.0.1:4444', i2p: true },
      { id: 'p1', name: '', url: 'socks5://h:1', i2p: true },
    ]);
    expect(i2pProxy(form)?.name).toBe('i2pd');
    expect(i2pProxy(live)).toBeUndefined();
  });

  it('finds or makes the rule for .i2p relays', () => {
    expect(i2pRule('p1')).toEqual({ name: '', match: ['*.i2p'], keys: [], to: { proxy: 'p1' }, fallback: 'offline' });
    expect(i2pRuleIndex([i2pRule('a')])).toBe(0);
    expect(i2pRuleIndex([{ ...i2pRule('a'), match: ['*.onion'] }])).toBe(-1);
  });

  it('checks registries like the service', () => {
    const ok = 'http://notbob.i2p/cgi-bin/jump.cgi?q={name}';
    expect(registryProblem(ok, [])).toBe('');
    expect(registryProblem('http://reg.i2p?q={name}', [])).toBe('');
    expect(registryProblem(ok, [ok])).toBe('That registry is already listed.');
    expect(registryProblem('http://a.i2p/ q={name}', [])).toContain('no spaces');
    expect(registryProblem(`http://a.i2p/${'x'.repeat(200)}{name}`, [])).toContain('200 characters');
    expect(registryProblem('https://a.i2p/{name}', [])).toBe('A registry address starts with http://.');
    for (const bad of ['http://a.i2p:80/{name}', 'http://A.i2p/{name}', 'http://u@a.i2p/{name}', 'http://example.com/{name}', 'http://.i2p/{name}']) {
      expect(registryProblem(bad, []), bad).toContain('lowercase .i2p host');
    }
    expect(registryProblem('http://a.i2p/?q=', [])).toContain('{name}');
  });

  it('sends changed registries', () => {
    const live = settings().proxies;
    expect(proxiesPatch(live, { ...live })).toEqual({});
    expect(proxiesPatch(live, { ...live, i2p_registries: [] })).toEqual({ i2p_registries: [] });
  });
});
