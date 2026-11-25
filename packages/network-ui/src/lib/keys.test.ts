import { describe, expect, it } from 'vitest';
import { ADMIN, assignmentProblem, dependents, keyTag, relayKeysFor, relayKeysText, relayUsers, relaysOf, replacements, toggled, usersOf } from './keys';
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

  it("lists one key's relays", () => {
    const relays = ['wss://a.example', 'wss://b.example'];
    expect(relaysOf(relays, { 'wss://b.example': ['invoices'] }, 'admin', ids)).toEqual(['wss://a.example']);
  });

  it('names a key with no relay, which could not be reached', () => {
    const keys = keyInfos();
    const ok = settings({ relays: ['wss://a.example', 'wss://b.example'], relay_keys: { 'wss://b.example': ['invoices'] } });
    expect(assignmentProblem(keys, ok)).toBe('');
    const noRelay = settings({ relays: ['wss://a.example'], relay_keys: { 'wss://a.example': ['invoices'] } });
    expect(assignmentProblem(keys, noRelay)).toContain('No relay is assigned to Administration');
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
