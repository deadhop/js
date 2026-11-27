import { describe, expect, it } from 'vitest';
import fixture from '../../../../fixtures/route-patterns.json';
import {
  POLICIES,
  REASONS,
  connectsWhileOffline,
  defaultFor,
  destination,
  destinations,
  directEnd,
  fallbackText,
  firstRule,
  groupName,
  hostPort,
  isLocalOrOverlay,
  liveNow,
  matches,
  neverDirect,
  newRule,
  patternProblem,
  proxyName,
  resolve,
  rulesProblem,
  sameDestination,
  usedBy,
  keysUsing,
  usesDefault,
} from './routes';
import type { Destination, NetworkSettings, Rule } from './schemas';
import { activePool, fourKeys, group, keyInfos, lane, settings } from '../test-helpers';

const ids = ['invoices', 'admin'];
const keys = [
  { id: 'invoices', label: 'Public invoices' },
  { id: 'admin', label: 'Administration' },
];
const entry = (id: string) => ({ id, name: id, url: `socks5://${id}:1` });
const rule = (match: string[], to: Rule['to'], over: Partial<Rule> = {}): Rule => ({ name: '', match, keys: [], to, fallback: 'offline', ...over });

const ONION = 'ws://abc.onion';
const LAN = 'ws://relay.lan:4869';
const VPN = 'wss://relay.contextvm.org';
const PLAIN = 'wss://bucket.coracle.social';

function setup(rules: Rule[], over: Partial<NetworkSettings> = {}): NetworkSettings {
  const s = settings({ relays: [VPN, PLAIN, ONION, LAN], ...over });
  return { ...s, proxies: { ...s.proxies, list: [entry('tor'), entry('vpn'), entry('i2p')], groups: [group('exits', ['tor', 'vpn'], { name: 'Exits' })], default: { proxy: 'tor' }, rules } };
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
  /** Every proxy is up and every group uses its first proxy, except those named down. */
  const nowWith =
    (s: NetworkSettings, down: string[] = []) =>
    (d: Destination) => {
      const ids = 'group' in (d as object) ? s.proxies.groups.find((g) => g.id === (d as { group: string }).group)!.proxies : [(d as { proxy: string }).proxy];
      return ids.find((id) => !down.includes(id) && s.proxies.list.some((e) => e.id === id)) ?? null;
    };
  const table = (s: NetworkSettings, key: string, down: string[] = [], offline: boolean | null = false) => resolve(s, key, ids, nowWith(s, down), offline).map((r) => [r.relay, r.rule, r.via, r.reason]);

  it('takes the first matching rule, and the default route for the rest', () => {
    const s = setup([rule(['*.onion'], { proxy: 'tor' }), rule(['*.lan'], 'direct'), rule([VPN], { group: 'exits' }), rule(['*.contextvm.org'], 'block')]);
    expect(table(s, 'invoices')).toEqual([
      [VPN, 2, { proxy: 'tor' }, 'rule'],
      [PLAIN, -1, { proxy: 'tor' }, 'default'],
      [ONION, 0, { proxy: 'tor' }, 'rule'],
      [LAN, 1, 'direct', 'rule'],
    ]);
    // A group uses whichever of its proxies is up.
    expect(table(s, 'invoices', ['tor'])[0]).toEqual([VPN, 2, { proxy: 'vpn' }, 'rule']);
  });

  it('falls back as the rule says: stay offline, the offline policy, or another destination', () => {
    const s = setup([
      rule([VPN], { group: 'exits' }),
      rule([PLAIN], { proxy: 'vpn' }, { fallback: 'policy' }),
      rule([ONION], { proxy: 'vpn' }, { fallback: { to: { proxy: 'i2p' } } }),
      rule([LAN], { proxy: 'vpn' }, { fallback: { to: 'direct' } }),
    ]);
    expect(table(s, 'invoices', ['tor', 'vpn'])).toEqual([
      [VPN, 0, 'off', 'proxy_down'],
      [PLAIN, 1, 'off', 'pool_offline'],
      [ONION, 2, { proxy: 'i2p' }, 'fallback'],
      [LAN, 3, 'direct', 'fallback'],
    ]);
    // The policy connects straight for this key; a fallback that is down too follows the policy.
    expect(table(s, 'invoices', ['tor', 'vpn', 'i2p'], true).slice(1, 3)).toEqual([
      [PLAIN, 1, 'direct', 'rule'],
      [ONION, 2, 'off', 'never_direct'],
    ]);
    expect(table(s, 'invoices', ['tor', 'vpn', 'i2p'], false)[2]).toEqual([ONION, 2, 'off', 'pool_offline']);
    // Its proxy down, a "stay offline" rule through one proxy still goes through it (never another way).
    const one = setup([rule([ONION], { proxy: 'tor' })]);
    expect(table(one, 'invoices', ['tor'])[2]).toEqual([ONION, 0, { proxy: 'tor' }, 'rule']);
  });

  it('follows the offline policy when the default route has nothing reachable, and waits before anything was checked', () => {
    const s = setup([]);
    expect(table(s, 'invoices', ['tor'], true)[0]).toEqual([VPN, -1, 'direct', 'default']);
    expect(table(s, 'invoices', ['tor'], false)[0]).toEqual([VPN, -1, 'off', 'pool_offline']);
    expect(table(s, 'invoices', ['tor'], null)[0]).toEqual([VPN, -1, 'off', 'pool_offline']);
  });

  it('applies per-key rules, per-key default routes and block, and never sends Tor straight', () => {
    const s = setup([rule(['*'], 'block', { keys: ['admin'] })]);
    s.proxies.default_keys = { invoices: 'direct' };
    expect(table(s, 'admin')[0]).toEqual([VPN, 0, 'off', 'blocked']);
    expect(table(s, 'invoices').slice(0, 3)).toEqual([
      [VPN, -1, 'direct', 'default'],
      [PLAIN, -1, 'direct', 'default'],
      [ONION, -1, 'off', 'never_direct'],
    ]);
    s.proxies.default_keys = { invoices: 'block' };
    expect(table(s, 'invoices')[0]).toEqual([VPN, -1, 'off', 'blocked']);
    const t = setup([rule([LAN], 'block')]);
    t.proxies.transparent = true;
    expect(table(t, 'invoices', ['tor', 'vpn']).slice(2)).toEqual([
      [ONION, -1, 'direct', 'transparent'],
      [LAN, 0, 'off', 'blocked'],
    ]);
    // A fallback that blocks blocks.
    const fb = setup([rule([VPN], { proxy: 'vpn' }, { fallback: { to: 'block' } })]);
    expect(table(fb, 'invoices', ['vpn'])[0]).toEqual([VPN, 0, 'off', 'blocked']);
    // A default route that blocks blocks there too.
    t.proxies.default = 'block';
    expect(table(t, 'invoices', ['tor', 'vpn'])[2]).toEqual([ONION, -1, 'off', 'blocked']);
    // A rule to a proxy that is gone counts as down; relays for one key only stay with it.
    const gone = setup([rule(['*.onion'], { proxy: 'gone' })], { relay_keys: { [LAN]: ['admin'] } });
    expect(table(gone, 'invoices').map((r) => r[0])).toEqual([VPN, PLAIN, ONION]);
    expect(table(gone, 'invoices')[2]).toEqual([ONION, 0, 'off', 'proxy_down']);
  });

  it('knows which keys use the default route', () => {
    expect(usesDefault(setup([]), 'invoices', ids)).toBe(true);
    expect(usesDefault(setup([rule(['*'], { proxy: 'i2p' })]), 'invoices', ids)).toBe(false);
    expect(usesDefault(setup([rule(['*'], { proxy: 'i2p' }, { fallback: 'policy' })]), 'invoices', ids)).toBe(false);
    expect(usesDefault(setup([rule(['*.onion'], 'direct')]), 'invoices', ids)).toBe(true);
    expect(firstRule([], 'invoices', VPN)).toBe(-1);
    expect(defaultFor({ default: 'direct', default_keys: { admin: 'block' } }, 'admin')).toBe('block');
    expect(defaultFor({ default: 'direct', default_keys: { admin: 'block' } }, 'invoices')).toBe('direct');
  });
});

describe('the live preview', () => {
  const [invoices, admin] = keyInfos();
  const p = setup([]).proxies;

  it('reads the offline policy per key like the service', () => {
    const table = POLICIES.map((x) => [x.value, connectsWhileOffline(invoices, x.value), connectsWhileOffline(admin, x.value)]);
    expect(table).toEqual([
      ['kill_switch', false, false],
      ['admin_only', false, true],
      ['invoicing_only', true, false],
      ['open', true, true],
    ]);
  });

  it('uses what health reports, else the first listed proxy not known to be down', () => {
    const pool = activePool({
      offline: 'admin_only',
      proxies: [{ ...activePool().proxies[0], id: 'tor', reachable: false }],
      lanes: [lane('admin', { default: { proxy: 'tor' }, active: null, groups: [{ group: 'exits', state: 'active', active: 'vpn', reachable: 1, next_switch_at: null }] })],
    });
    const a = liveNow(pool, p, admin);
    expect(a.offline).toBe(true);
    expect(a.now({ proxy: 'tor' })).toBeNull();
    expect(a.now({ group: 'exits' })).toBe('vpn');
    expect(a.now({ proxy: 'vpn' })).toBe('vpn');
    expect(a.now({ proxy: 'gone' })).toBeNull();
    // Not reported (a group not saved yet, or a key health does not list).
    const two = { ...p, groups: [...p.groups, group('new', ['tor', 'vpn']), group('dead', ['tor', 'gone'])] };
    const b = liveNow(pool, two, invoices);
    expect(b.offline).toBeNull();
    expect(b.now({ group: 'new' })).toBe('vpn');
    expect(b.now({ group: 'dead' })).toBeNull();
    expect(b.now({ group: 'missing' })).toBeNull();
    const c = liveNow(null, p, invoices);
    expect([c.now({ proxy: 'tor' }), c.offline]).toEqual(['tor', null]);
  });
});

describe('rulesProblem', () => {
  const problem = (rules: Rule[], dashboard: string[] = [VPN], over: Partial<NetworkSettings> = {}) => rulesProblem(setup(rules, over), keys, dashboard);
  const withDefault = (d: Partial<NetworkSettings['proxies']>, dashboard: string[] = [VPN]) => {
    const s = setup([]);
    return rulesProblem({ ...s, proxies: { ...s.proxies, ...d } }, keys, dashboard);
  };

  it('accepts a sound list and says what is wrong with a bad one', () => {
    expect(problem([rule(['*.onion'], { proxy: 'tor' }), rule(['*.lan'], 'direct'), rule([VPN], { group: 'exits' }, { fallback: { to: { proxy: 'vpn' } } })])).toBe('');
    expect(problem(Array.from({ length: 33 }, () => rule(['*'], 'direct')))).toMatch(/At most 32/);
    expect(problem([rule([], 'direct')])).toMatch(/Rule 1: between 1 and 16/);
    expect(problem([rule(['a b'], 'direct')])).toMatch(/Rule 1: Pattern 'a b'/);
    expect(problem([rule(['*'], { proxy: 'gone' })])).toBe('Rule 1 goes through a proxy that is no longer listed. Change it first.');
    expect(problem([rule(['*'], { group: 'gone' })])).toBe('Rule 1 goes through a group that no longer exists. Change it first.');
    expect(problem([rule(['*'], { proxy: 'tor' }, { fallback: { to: { group: 'gone' } } })])).toMatch(/^The fallback of rule 1 goes through a group/);
    expect(problem([rule(['*.onion'], 'direct')])).toMatch(/never directly/);
    expect(problem([rule([ONION], { proxy: 'tor' }, { fallback: { to: 'direct' } })])).toMatch(/never directly/);
    // A fallback a rule never takes is not checked.
    expect(problem([rule([ONION], 'block', { fallback: { to: 'direct' } }), rule(['*'], { proxy: 'tor' })])).toBe('');
    // Behind a transparent proxy nothing goes straight.
    const t = setup([rule(['*.onion'], 'direct')]);
    expect(rulesProblem({ ...t, proxies: { ...t.proxies, transparent: true } }, keys, [VPN])).toBe('');
    expect(problem([rule(['*'], 'block')])).toMatch(/block every relay of Public invoices/);
    expect(problem([rule(['*'], 'block', { keys: ['admin'] })])).toMatch(/Administration/);
  });

  it('checks the default route and the per-key ones', () => {
    expect(withDefault({ default: { group: 'gone' } })).toBe('The default route goes through a group that no longer exists. Change it first.');
    expect(withDefault({ default_keys: { admin: { proxy: 'gone' } } })).toBe('The default route of Administration goes through a proxy that is no longer listed. Change it first.');
    expect(withDefault({ default_keys: { admin: 'direct' } })).toBe('');
    // A default route of block for a key with no rule is a key cut off.
    expect(withDefault({ default_keys: { invoices: 'block' } })).toMatch(/block every relay of Public invoices/);
    expect(withDefault({ default: 'block', rules: [rule([VPN], 'direct')] }, [])).toBe('');
  });

  it('refuses a list that locks this page out', () => {
    expect(problem([rule([VPN], 'block', { keys: ['admin'] })])).toMatch(/signs in through/);
    // Another relay of this page is still open: fine; and with no relay of this page, nothing to protect.
    expect(problem([rule([VPN], 'block', { keys: ['admin'] })], [VPN, PLAIN])).toBe('');
    expect(problem([rule([VPN], 'block', { keys: ['admin'] })], [])).toBe('');
    expect(rulesProblem(setup([]), [keys[0]], [VPN])).toBe('');
  });
});

describe('words', () => {
  const p = { list: [entry('tor'), { ...entry('x'), name: '' }], groups: [group('exits', ['tor', 'x'], { name: 'Exits' }), group('g2', ['tor', 'x'])] };

  it('names destinations, fallbacks, groups, proxies and reasons', () => {
    expect(destination('direct', p)).toMatch(/Direct/);
    expect(destination('block', p)).toMatch(/blocked/);
    expect(destination({ proxy: 'tor' }, p)).toBe('tor');
    expect(destination({ proxy: 'x' }, p)).toBe('socks5://x:1');
    expect(destination({ proxy: 'zz' }, p)).toMatch(/no longer listed/);
    expect(destination({ group: 'exits' }, p)).toBe('Group Exits');
    expect(destination({ group: 'g2' }, p)).toBe('Group g2');
    expect(destination({ group: 'zz' }, p)).toMatch(/no longer exists/);
    expect(groupName({ id: 'g', name: '' })).toBe('g');
    expect(destinations(p)).toEqual([{ proxy: 'tor' }, { proxy: 'x' }, { group: 'exits' }, { group: 'g2' }, 'direct', 'block']);
    expect(fallbackText('offline', p)).toMatch(/stay offline/);
    expect(fallbackText('policy', p)).toMatch(/offline policy decides/);
    expect(fallbackText({ to: { group: 'exits' } }, p)).toBe('If down: Group Exits, then the offline policy');
    expect(proxyName({ name: '', url: 'u' })).toBe('u');
    expect(Object.keys(REASONS)).toHaveLength(8);
    expect(sameDestination({ proxy: 'a' }, { proxy: 'a' }) && !sameDestination({ proxy: 'a' }, { group: 'a' })).toBe(true);
  });

  it('says when a route can end in a direct connection', () => {
    expect(directEnd('direct', 'offline', 'kill_switch', p)).toMatch(/connect straight/);
    expect(directEnd('block', 'policy', 'open', p)).toBe('');
    expect(directEnd({ proxy: 'tor' }, { to: 'direct' }, 'kill_switch', p)).toMatch(/^While tor has nothing reachable, these relays connect straight/);
    expect(directEnd({ proxy: 'tor' }, 'offline', 'open', p)).toBe('');
    expect(directEnd({ proxy: 'tor' }, 'policy', 'kill_switch', p)).toBe('');
    // A fallback that blocks never reaches the policy.
    expect(directEnd({ proxy: 'tor' }, { to: 'block' }, 'open', p)).toBe('');
    expect(directEnd({ group: 'exits' }, 'policy', 'admin_only', p)).toMatch(/^While Group Exits has nothing reachable, the offline policy \(Operators only\) connects/);
    expect(directEnd({ proxy: 'tor' }, { to: { group: 'exits' } }, 'open', p)).toMatch(/^While tor and Group Exits both have nothing reachable, the offline policy \(Carry on\)/);
  });

  it('lists what points at a proxy or a group', () => {
    const s = {
      ...setup([rule(['*'], { proxy: 'tor' }), rule(['*.onion'], { group: 'exits' }, { fallback: { to: { proxy: 'tor' } } })]).proxies,
      default_keys: { admin: { group: 'exits' }, ghost: { proxy: 'tor' } } as Record<string, Destination>,
    };
    expect(usedBy(s, { proxy: 'tor' }, keys)).toEqual(['group Exits', 'rule 1', 'the fallback of rule 2', 'the default route', 'the default route of ghost']);
    expect(usedBy(s, { group: 'exits' }, keys)).toEqual(['rule 2', 'the default route of Administration']);
    expect(usedBy(s, { proxy: 'i2p' }, keys)).toEqual([]);
  });

  it('lists the keys that may send relays through a proxy or a group', () => {
    const four = fourKeys();
    const base = setup([]).proxies;
    // The default route is tor: every key.
    expect(keysUsing(base, { proxy: 'tor' }, four)).toEqual(['invoices', 'catering', 'oven', 'admin']);
    const s = {
      ...base,
      default: 'direct' as Destination,
      default_keys: { admin: { group: 'exits' } } as Record<string, Destination>,
      rules: [rule(['*.onion'], { proxy: 'i2p' }, { keys: ['catering'] }), rule(['*'], 'direct', { keys: ['oven'] }), rule(['*.lan'], { proxy: 'i2p' }, { keys: ['invoices'], fallback: { to: { proxy: 'vpn' } } })],
    };
    expect(keysUsing(s, { proxy: 'i2p' }, four)).toEqual(['invoices', 'catering']);
    // Through the group the administration key's default route points at, and a fallback.
    expect(keysUsing(s, { proxy: 'vpn' }, four)).toEqual(['invoices', 'admin']);
    expect(keysUsing(s, { group: 'exits' }, four)).toEqual(['admin']);
    expect(keysUsing(s, { proxy: 'tor' }, four)).toEqual(['admin']);
    expect(keysUsing({ ...s, default_keys: {} }, { proxy: 'tor' }, four)).toEqual([]);
  });

  it('starts a new rule at the first group, else the first proxy, else direct', () => {
    expect(newRule(p).to).toEqual({ group: 'exits' });
    expect(newRule({ list: p.list, groups: [] }).to).toEqual({ proxy: 'tor' });
    expect(newRule({ list: [], groups: [] })).toEqual({ name: '', match: [], keys: [], to: 'direct', fallback: 'offline' });
  });
});
