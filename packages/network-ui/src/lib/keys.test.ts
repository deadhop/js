import { describe, expect, it } from 'vitest';
import { ADMIN, assignmentProblem, dependents, keyTag, proxiesOf, relayKeysFor, relayKeysText, relayUsers, relaysOf, replacements, toggled, usersOf } from './keys';
import { keyInfos, settings } from '../test-helpers';

const ids = ['invoices', 'admin'];

describe('who uses what', () => {
  it('reads an empty or missing assignment as every key', () => {
    expect(usersOf(undefined, ids)).toEqual(ids);
    expect(usersOf([], ids)).toEqual(ids);
    expect(usersOf(['admin'], ids)).toEqual(['admin']);
  });

  it('finds a relay by its address, ignoring a trailing slash', () => {
    const map = { 'wss://a.example/': ['admin'] };
    expect(relayUsers(map, 'wss://a.example', ids)).toEqual(['admin']);
    expect(relayUsers(map, 'wss://b.example', ids)).toEqual(ids);
  });

  it('switches one key on or off and stores everything-on as empty', () => {
    expect(toggled([], 'admin', false, ids)).toEqual(['invoices']);
    expect(toggled(['invoices'], 'admin', true, ids)).toEqual([]);
    expect(toggled(['invoices'], 'invoices', true, ids)).toEqual(['invoices']);
    expect(toggled(['admin'], 'invoices', true, ids)).toEqual([]);
  });

  it('keeps only restricted relays that are listed, and compares maps without regard to order', () => {
    const map = { 'wss://a.example': ['admin', 'invoices'], 'wss://b.example': ['invoices'], 'wss://gone.example': ['admin'] };
    const kept = relayKeysFor(['wss://a.example', 'wss://b.example'], map, ids);
    expect(kept).toEqual({ 'wss://b.example': ['invoices'] });
    expect(relayKeysText({ 'wss://b.example/': ['admin', 'invoices'], 'wss://a.example': ['invoices'] })).toBe(relayKeysText({ 'wss://a.example': ['invoices'], 'wss://b.example': ['invoices', 'admin'] }));
  });

  it("lists one key's relays and proxies", () => {
    const relays = ['wss://a.example', 'wss://b.example'];
    expect(relaysOf(relays, { 'wss://b.example': ['invoices'] }, 'admin', ids)).toEqual(['wss://a.example']);
    const proxies = { ...settings().proxies, list: [{ id: 'a', name: '', url: 'socks5://h:1', keys: ['invoices'], pool: true }, { id: 'b', name: '', url: 'socks5://h:2', keys: [], pool: true }] };
    expect(proxiesOf(proxies, 'admin', ids).map((p) => p.id)).toEqual(['b']);
  });

  it('names what cannot be saved: a key with no relay, or no proxy beside a list', () => {
    const keys = keyInfos();
    const ok = settings({ relays: ['wss://a.example', 'wss://b.example'], relay_keys: { 'wss://b.example': ['invoices'] } });
    expect(assignmentProblem(keys, ok)).toBe('');
    const noRelay = settings({ relays: ['wss://a.example'], relay_keys: { 'wss://a.example': ['invoices'] } });
    expect(assignmentProblem(keys, noRelay)).toContain('No relay is assigned to Administration');
    const only = (keysOf: string[], transparent = false) => settings({ proxies: { ...settings().proxies, transparent, list: [{ id: 'a', name: '', url: 'socks5://h:1', keys: keysOf, pool: true }] } });
    expect(assignmentProblem(keys, only(['invoices']))).toContain('No proxy in the default route is assigned to Administration');
    // A proxy kept out of the default route does not count, unless no relay of the key takes it.
    const rulesOnly = settings({ proxies: { ...settings().proxies, list: [{ id: 'a', name: '', url: 'socks5://h:1', keys: [], pool: false }] } });
    expect(assignmentProblem(keys, rulesOnly)).toContain('Public invoices');
    const allRuled = { ...rulesOnly, proxies: { ...rulesOnly.proxies, rules: [{ name: '', match: ['*'], keys: [], to: { proxy: 'a' }, fallback: 'offline' as const }] } };
    expect(assignmentProblem(keys, allRuled)).toBe('');
    expect(assignmentProblem(keys, only([]))).toBe('');
    // Nothing to assign when the proxy is the operator's own, or there is none.
    expect(assignmentProblem(keys, only(['invoices'], true))).toBe('');
  });

  it('shortens key ids for badges', () => {
    expect(keyTag('invoices')).toBe('Invoices');
    expect(keyTag('admin')).toBe('Admin');
    expect(keyTag('reports')).toBe('reports');
  });
});

describe('relays a key depends on', () => {
  const A = 'wss://a.example';
  const B = 'wss://b.example';
  const DASH = 'ws://127.0.0.1:7777';

  it('names the keys that would have no relay left', () => {
    // invoices uses only A; admin uses A and B.
    const map = { [B]: [ADMIN] };
    expect(dependents([A, B], map, `${A}/`, ids, [])).toEqual(['invoices']);
    expect(dependents([A, B], map, B, ids, [])).toEqual([]);
    expect(dependents([A, B], {}, A, ids, [])).toEqual([]);
    // A relay a key does not use is never one it depends on.
    expect(dependents([A, B], { [A]: ['invoices'], [B]: [ADMIN] }, A, ids, [])).toEqual(['invoices']);
  });

  it("keeps the administration key on a relay this page connects through when it is the last such", () => {
    expect(dependents([DASH, A], {}, DASH, ids, [DASH])).toEqual([ADMIN]);
    expect(dependents([DASH, A], {}, DASH, ids, [DASH, A])).toEqual([]);
    expect(dependents([DASH, A], {}, A, ids, [DASH])).toEqual([]);
  });

  it('offers the other relays, and this page\'s own when not listed, as replacements', () => {
    expect(replacements([A, B], `${A}/`, 'invoices', [DASH])).toEqual([B, DASH]);
    expect(replacements([A, DASH], A, 'invoices', [`${DASH}/`])).toEqual([DASH]);
    // The administration key losing a dashboard relay is offered only dashboard relays.
    expect(replacements([A, DASH, B], DASH, ADMIN, [DASH, B])).toEqual([B]);
    expect(replacements([A, B], A, ADMIN, [DASH])).toEqual([B, DASH]);
  });
});
