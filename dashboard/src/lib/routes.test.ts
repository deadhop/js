import { describe, expect, it } from 'vitest';
import fixture from '../../../fixtures/route-patterns.json';
import { REASONS, destination, firstRule, hostPort, isLocalOrOverlay, matches, neverDirect, newRule, patternProblem, proxyName, resolve, rulesProblem, usesDefault } from './routes';
import type { Rule, Settings } from './schemas';
import { settings } from '../test-helpers';

const ids = ['invoices', 'admin'];
const keys = [
  { id: 'invoices', label: 'Public invoices' },
  { id: 'admin', label: 'Administration' },
];
const entry = (id: string, pool = true) => ({ id, name: id, url: `socks5://${id}:1`, keys: [], pool });
const rule = (match: string[], to: Rule['to'], over: Partial<Rule> = {}): Rule => ({ ...newRule(), match, to, ...over });

const ONION = 'ws://abc.onion';
const LAN = 'ws://relay.lan:4869';
const VPN = 'wss://relay.contextvm.org';
const PLAIN = 'wss://bucket.coracle.social';

function setup(rules: Rule[], over: Partial<Settings> = {}): Settings {
  const s = settings({ relays: [VPN, PLAIN, ONION, LAN], ...over });
  return { ...s, proxies: { ...s.proxies, list: [entry('tor'), entry('vpn'), entry('i2p', false)], rules } };
}

describe('patterns', () => {
  it('match exactly as the service matches them (shared cases)', () => {
    expect(fixture.cases.length).toBeGreaterThan(20);
    for (const [pattern, relay, want] of fixture.cases as [string, string, boolean][]) {
      expect(matches(pattern, relay), `${pattern} vs ${relay}`).toBe(want);
    }
  });

  it('are checked, with a reason', () => {
    for (const good of ['*.onion', 'relay.example:7777', '[::1]:80', 'wss://relay.example', '*']) expect(patternProblem(good)).toBe('');
    expect(patternProblem('  ')).toMatch(/empty/);
    expect(patternProblem('x'.repeat(257))).toMatch(/too long/);
    expect(patternProblem('https://relay.example')).toMatch(/not a relay address/);
    expect(patternProblem('wss://')).toMatch(/not a relay address/);
    expect(patternProblem('relay example')).toMatch(/may hold only/);
    expect(patternProblem('relay.example:port')).toMatch(/not a number/);
    expect(patternProblem('relay.example:99999')).toMatch(/not a number/);
    expect(matches('[::1', 'ws://[::1]:7777')).toBe(false);
  });

  it('read hosts and ports, and know which relays are local, overlay or never direct', () => {
    expect(hostPort('ws://[::1]:7777')).toEqual({ host: '::1', port: 7777 });
    expect(hostPort('wss://A.example')).toEqual({ host: 'a.example', port: 443 });
    expect(hostPort('ws://a.example')).toEqual({ host: 'a.example', port: 80 });
    expect(hostPort('nonsense')).toBeNull();
    expect(neverDirect('ws://abc.onion') && neverDirect('ws://x.b32.i2p.')).toBe(true);
    expect(neverDirect('ws://x.fips') || neverDirect('wss://relay.example') || neverDirect('nope')).toBe(false);
    for (const local of ['ws://abc.onion', 'ws://x.fips:1', 'ws://relay.lan', 'ws://localhost:1', 'ws://[::1]:1', 'ws://[fd12::1]:1', 'ws://10.0.0.1', 'ws://172.20.0.1', 'ws://192.168.1.2', 'ws://127.0.0.1', 'ws://169.254.1.1', 'ws://100.64.0.1', 'ws://box', 'nonsense']) {
      expect(isLocalOrOverlay(local), local).toBe(true);
    }
    for (const open of ['wss://relay.example', 'ws://8.8.8.8', 'ws://172.32.0.1', 'ws://[2001:db8::1]']) expect(isLocalOrOverlay(open), open).toBe(false);
  });
});

describe('resolve', () => {
  const pool = { proxy: 'tor' };
  const table = (s: Settings, key: string, d: Parameters<typeof resolve>[3], up: (id: string) => boolean) =>
    resolve(s, key, ids, d, up).map((r) => [r.relay, r.rule, r.via, r.reason]);

  it('takes the first matching rule, falls back or stays offline as the rule says', () => {
    const s = setup([rule(['*.onion'], { proxy: 'tor' }), rule(['*.lan'], 'direct'), rule([VPN], { proxy: 'vpn' }, { fallback: 'pool' }), rule(['*.contextvm.org'], 'block')]);
    expect(table(s, 'invoices', pool, () => true)).toEqual([
      [VPN, 2, { proxy: 'vpn' }, 'rule'],
      [PLAIN, -1, { proxy: 'tor' }, 'default'],
      [ONION, 0, { proxy: 'tor' }, 'rule'],
      [LAN, 1, 'direct', 'rule'],
    ]);
    expect(table(s, 'invoices', pool, (id) => id !== 'vpn')[0]).toEqual([VPN, 2, { proxy: 'tor' }, 'fallback']);
    expect(table(s, 'invoices', pool, (id) => id !== 'tor')[2]).toEqual([ONION, 0, 'off', 'proxy_down']);
    expect(table(s, 'invoices', 'off', (id) => id !== 'vpn').slice(0, 2)).toEqual([
      [VPN, 2, 'off', 'pool_offline'],
      [PLAIN, -1, 'off', 'pool_offline'],
    ]);
  });

  it('applies per-key rules, block and pool, and never sends Tor straight', () => {
    const s = setup([rule([PLAIN], 'pool'), rule(['*'], 'block', { keys: ['admin'] })]);
    expect(table(s, 'admin', pool, () => true).slice(0, 2)).toEqual([
      [VPN, 1, 'off', 'blocked'],
      [PLAIN, 0, { proxy: 'tor' }, 'rule'],
    ]);
    expect(table(s, 'invoices', 'direct', () => true)[2]).toEqual([ONION, -1, 'off', 'never_direct']);
    const t = setup([rule([LAN], 'block')], {});
    t.proxies.transparent = true;
    expect(table(t, 'invoices', 'off', () => false).slice(2)).toEqual([
      [ONION, -1, 'direct', 'transparent'],
      [LAN, 0, 'off', 'blocked'],
    ]);
    // A rule to a proxy that is gone counts as down; relays for one key only stay with it.
    const gone = setup([rule(['*.onion'], { proxy: 'gone' })], { relay_keys: { [LAN]: ['admin'] } });
    expect(table(gone, 'invoices', pool, () => true).map((r) => r[0])).toEqual([VPN, PLAIN, ONION]);
    expect(table(gone, 'invoices', pool, () => true)[2][2]).toBe('off');
  });

  it('knows which keys use the default route', () => {
    expect(usesDefault(setup([]), 'invoices', ids)).toBe(true);
    expect(usesDefault(setup([rule(['*'], { proxy: 'i2p' })]), 'invoices', ids)).toBe(false);
    expect(usesDefault(setup([rule(['*'], { proxy: 'i2p' }, { fallback: 'pool' })]), 'invoices', ids)).toBe(true);
    expect(usesDefault(setup([rule(['*'], 'pool')]), 'invoices', ids)).toBe(true);
    expect(usesDefault(setup([rule(['*'], 'direct')]), 'invoices', ids)).toBe(false);
    expect(firstRule([], 'invoices', VPN)).toBe(-1);
  });
});

describe('rulesProblem', () => {
  const saved = [entry('tor'), entry('vpn'), entry('i2p', false)];
  const problem = (rules: Rule[], dashboard: string[] = [VPN], over: Partial<Settings> = {}) => rulesProblem(setup(rules, over), keys, saved, dashboard);

  it('accepts a sound list and says what is wrong with a bad one', () => {
    expect(problem([rule(['*.onion'], { proxy: 'tor' }), rule(['*.lan'], 'direct')])).toBe('');
    expect(problem(Array.from({ length: 17 }, () => rule(['*'], 'pool')))).toMatch(/At most 16/);
    expect(problem([rule([], 'pool')])).toMatch(/Rule 1: between 1 and 16/);
    expect(problem([rule(['a b'], 'pool')])).toMatch(/Rule 1: Pattern 'a b'/);
    expect(problem([rule(['*'], { proxy: 'gone' })])).toMatch(/no longer listed/);
    expect(problem([rule(['*.onion'], 'direct')])).toMatch(/never directly/);
    expect(problem([rule([ONION], 'direct')])).toMatch(/never directly/);
    expect(problem([rule(['*'], 'block')])).toMatch(/block every relay of Public invoices/);
    expect(problem([rule(['*'], 'block', { keys: ['admin'] })])).toMatch(/Administration/);
  });

  it('refuses a rule to a proxy not saved yet, and one that locks this page out', () => {
    const s = setup([rule(['*'], { proxy: 'new' })]);
    s.proxies.list.push(entry('new'));
    expect(rulesProblem(s, keys, saved, [])).toMatch(/not saved yet/);
    expect(problem([rule([VPN], 'block', { keys: ['admin'] })])).toMatch(/signs in through/);
    // Another relay of this page is still open: fine; and with no relay of this page, nothing to protect.
    expect(problem([rule([VPN], 'block', { keys: ['admin'] })], [VPN, PLAIN])).toBe('');
    expect(problem([rule([VPN], 'block', { keys: ['admin'] })], [])).toBe('');
    expect(rulesProblem(setup([]), [keys[0]], saved, [VPN])).toBe('');
  });
});

describe('words', () => {
  it('names destinations, proxies and reasons', () => {
    const list = [entry('tor'), { ...entry('x'), name: '' }];
    expect(destination('pool', list)).toBe('The default route');
    expect(destination('direct', list)).toMatch(/Direct/);
    expect(destination('block', list)).toMatch(/blocked/);
    expect(destination({ proxy: 'tor' }, list)).toBe('tor');
    expect(destination({ proxy: 'x' }, list)).toBe('socks5://x:1');
    expect(destination({ proxy: 'zz' }, list)).toMatch(/no longer listed/);
    expect(proxyName({ name: '', url: 'u' })).toBe('u');
    expect(Object.keys(REASONS)).toHaveLength(8);
  });
});
