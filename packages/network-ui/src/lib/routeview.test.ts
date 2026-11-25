import { describe, expect, it } from 'vitest';
import { groupStateText, groupSummaries, keyLabel, mapRows, proxySummaries, reaches, ruleText, tiles, trace } from './routeview';
import type { RouteState, Rule } from './schemas';
import { group, keyInfos, lane, proxyPool, settings } from '../test-helpers';

const route = (over: Partial<RouteState>): RouteState => ({ key: 'invoices', relay: 'wss://a.example', rule: null, via: 'proxy', proxy: 'tor', reason: 'default', ...over });
const rule = (match: string[], to: Rule['to'], keys: string[] = []): Rule => ({ name: '', match, keys, to, fallback: 'offline' });

describe('the map', () => {
  it('merges a relay whose keys agree, and splits one whose keys differ', () => {
    const routes = [
      route({ key: 'invoices' }),
      route({ key: 'admin' }),
      route({ key: 'invoices', relay: 'wss://b.example', rule: 1, reason: 'rule' }),
      route({ key: 'admin', relay: 'wss://b.example', via: 'off', proxy: null, reason: 'blocked', rule: 2 }),
    ];
    expect(mapRows(routes, null)).toEqual([
      { relay: 'wss://a.example', keys: ['invoices', 'admin'], rule: null, via: 'proxy', proxy: 'tor', reason: 'default' },
      { relay: 'wss://b.example', keys: ['invoices'], rule: 1, via: 'proxy', proxy: 'tor', reason: 'rule' },
      { relay: 'wss://b.example', keys: ['admin'], rule: 2, via: 'off', proxy: null, reason: 'blocked' },
    ]);
    expect(mapRows(routes, 'admin').map((r) => r.reason)).toEqual(['default', 'blocked']);
    expect(mapRows([route({ key: 'admin' })], 'invoices')).toEqual([]);
  });

  it('says what each relay reaches', () => {
    expect(reaches('wss://a.example', 'off').what).toBe('Nothing');
    expect(reaches('ws://x.onion', 'proxy').what).toBe('Tor hidden service');
    expect(reaches('ws://x.b32.i2p', 'proxy').what).toBe('I2P site');
    expect(reaches('ws://n.fips:1', 'direct').what).toBe('FIPS mesh');
    expect(reaches('ws://relay.lan:1', 'direct').what).toBe('This network');
    expect(reaches('wss://a.example', 'proxy')).toEqual({ what: 'Internet', note: 'through the proxy' });
    expect(reaches('wss://a.example', 'direct').note).toMatch(/IP/);
    expect(reaches('nonsense', 'direct').what).toBe('This network');
  });

  it('names a row’s rule', () => {
    const rules = [rule(['*.onion', '*.i2p'], { proxy: 'tor' })];
    expect(ruleText(rules, null)).toBe('default route');
    expect(ruleText(rules, 1)).toBe('*.onion, *.i2p');
    expect(ruleText(rules, 4)).toBe('rule 4');
  });
});

describe('the tiles', () => {
  const live = settings({ proxies: { ...settings().proxies, rules: [rule(['*.onion'], { proxy: 'tor' }), rule(['*.i2p'], { proxy: 'tor' })] } });
  const pool = proxyPool({ proxies: [{ id: 'tor', name: 'tor', url: 'u', reachable: true, checked_at: 1, status: 'connected', reason: null }] });

  it('count relays, unused rules, down proxies and straight connections', () => {
    const routes = [route({ rule: 1, reason: 'rule' }), route({ relay: 'ws://relay.lan', via: 'direct', proxy: null })];
    const t = tiles(routes, live, pool);
    expect(t.map((x) => [x.value, x.line, x.tone])).toEqual([
      ['2', 'Every relay has a route', 'ok'],
      ['2', '1 match no relay yet', 'none'],
      ['1', 'None is down', 'ok'],
      ['1', 'None to the open internet', 'none'],
    ]);
  });

  it('warn about relays with no route, a proxy down and a relay straight to the internet', () => {
    const routes = [route({ via: 'off', proxy: null, reason: 'proxy_down', rule: 1 }), route({ relay: 'wss://b.example', via: 'direct', proxy: null, rule: 2, reason: 'rule' })];
    const down = proxyPool({ proxies: [{ ...pool.proxies[0], reachable: false }] });
    const t = tiles(routes, live, down);
    expect(t.map((x) => [x.line, x.tone])).toEqual([
      ['1 with no route now', 'bad'],
      ['Every rule is in use', 'none'],
      ['1 down', 'warn'],
      ["1 to the internet: they see this machine's IP", 'warn'],
    ]);
    expect(tiles([], settings(), proxyPool())[1].line).toBe('Every relay takes the default route');
  });
});

describe('proxy summaries and traces', () => {
  it('say what each proxy carries, which rules point at it, its groups and whether a default route uses it', () => {
    const list = [
      { id: 'tor', name: 'tor', url: 'socks5://t:1' },
      { id: 'vpn', name: '', url: 'socks5://v:1' },
      { id: 'i2p', name: 'i2p', url: 'socks5://i:1' },
      { id: 'own', name: 'own', url: 'socks5://o:1' },
    ];
    const proxies = { ...settings().proxies, list, groups: [group('exits', ['tor', 'vpn'], { name: 'Exits' })], default: { group: 'exits' } as const, default_keys: { admin: { proxy: 'own' } } };
    const live = settings({ proxies: { ...proxies, rules: [rule(['*.onion'], { proxy: 'tor' }), rule(['*.i2p'], { proxy: 'i2p' }), rule(['x'], 'direct')] } });
    const pool = proxyPool({ proxies: [{ id: 'tor', name: 'tor', url: 'socks5://t:1', reachable: true, checked_at: 1, status: 'connected', reason: null }] });
    const routes = [route({ relay: 'ws://x.onion', rule: 1, reason: 'rule' }), route({ relay: 'wss://b', reason: 'fallback', rule: 2 }), route({ key: 'admin', relay: 'wss://b', reason: 'fallback', rule: 2 })];
    const s = proxySummaries(routes, live, pool);
    expect(s[0]).toEqual({ id: 'tor', name: 'tor', url: 'socks5://t:1', reachable: true, carries: ['ws://x.onion', 'wss://b'], fallback: ['wss://b'], rules: [1], groups: ['Exits'], inDefault: true });
    expect(s[1]).toMatchObject({ name: 'socks5://v:1', reachable: null, carries: [], rules: [], groups: ['Exits'], inDefault: true });
    expect(s[2]).toMatchObject({ rules: [2], groups: [], inDefault: false });
    expect(s[3]).toMatchObject({ groups: [], inDefault: true });
  });

  it('say what each group uses now, once when the keys agree', () => {
    const at = 1_700_000_000;
    const proxies = { ...settings().proxies, list: [{ id: 'tor', name: 'Tor', url: 'socks5://t:1' }, { id: 'vpn', name: '', url: 'socks5://v:1' }], groups: [group('exits', ['tor', 'vpn'], { name: 'Exits' }), group('spare', ['vpn', 'tor'], { strategy: 'chaos' })], default: { group: 'exits' } as const };
    const health = (state: 'active' | 'suspended' | 'offline' | 'blocked', active: string | null, next: number | null = null) => ({ group: 'exits', state, active, reachable: state === 'active' ? 2 : 1, next_switch_at: next });
    const proxyList = [{ id: 'tor', name: 'Tor', url: 'socks5://t:1', reachable: true, checked_at: 1, status: 'connected', reason: null }];
    const same = proxyPool({ proxies: proxyList, lanes: [lane('invoices', { groups: [health('active', 'tor', at + 1800)] }), lane('admin', { groups: [health('active', 'tor', at + 1800)] })] });
    const s = groupSummaries(proxies, same, keyInfos(), at);
    expect(s[0]).toEqual({ id: 'exits', name: 'Exits', members: ['Tor', 'socks5://v:1'], strategy: 'Round-robin', lines: [{ key: '', text: 'using Tor · next switch in 30m', tone: 'ok' }], inDefault: true });
    expect(s[1]).toMatchObject({ name: 'spare', strategy: 'Chaos', lines: [], inDefault: false });
    const differ = proxyPool({ proxies: proxyList, lanes: [lane('invoices', { groups: [health('suspended', 'tor')] }), lane('admin', { groups: [health('offline', null)] })] });
    expect(groupSummaries(proxies, differ, keyInfos(), at)[0].lines).toEqual([
      { key: 'invoices', text: 'using Tor · rotation suspended: only 1 proxy is reachable', tone: 'warn' },
      { key: 'admin', text: 'offline: no proxy in the group is reachable', tone: 'bad' },
    ]);
    expect(groupStateText(health('blocked', null), { proxies: proxyList })).toBe('blocked');
    expect(groupStateText(health('active', 'gone'), { proxies: proxyList }, at)).toBe('');
    expect(groupSummaries(proxies, null, keyInfos())[0].lines).toEqual([]);
  });

  it('trace the rules up to the one that matches, and say which apply to the key', () => {
    const rules = [rule(['*.lan'], 'direct'), rule(['*'], 'block', ['admin']), rule(['*.example'], { proxy: 'tor' }), rule(['*'], { group: 'exits' })];
    expect(trace(rules, 'invoices', 'wss://a.example')).toEqual([
      { no: 1, match: '*.lan', forKey: true, matched: false },
      { no: 2, match: '*', forKey: false, matched: false },
      { no: 3, match: '*.example', forKey: true, matched: true },
    ]);
    expect(trace(rules.slice(0, 1), 'invoices', 'wss://a.example')).toEqual([{ no: 1, match: '*.lan', forKey: true, matched: false }]);
    expect(keyLabel(keyInfos(), 'admin')).toBe('Administration');
    expect(keyLabel(keyInfos(), 'zz')).toBe('zz');
  });
});
