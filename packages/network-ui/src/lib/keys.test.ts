import { describe, expect, it, vi } from 'vitest';
import { setContext } from 'svelte';
import { ADMIN, KEY_COLORS, setKeyColors, assignmentProblem, dependents, displayOrder, invoiceKeys, keyColor, keyColorClass, labelList, relayKeysFor, relayKeysText, relayUsers, relaysOf, replacements, sameFor, toggled, usersOf } from './keys';
import { fourKeys, keyInfos, settings } from '../test-helpers';

vi.mock('svelte', async (original) => ({ ...(await original<typeof import('svelte')>()), setContext: vi.fn() }));

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

});

describe('several keys', () => {
  const keys = fourKeys();

  it('puts the administration key first for display, and tells the invoice keys apart', () => {
    expect(displayOrder(keys).map((k) => k.id)).toEqual(['admin', 'invoices', 'catering', 'oven']);
    expect(invoiceKeys(keys).map((k) => k.id)).toEqual(['invoices', 'catering', 'oven']);
  });

  it('colours an invoice key by its place, or by the stored colour, and the administration key graphite', () => {
    expect(keys.map((k) => keyColor(keys, k.id))).toEqual([0, 1, 2, null]);
    expect(keyColor(keys, 'oven', { oven: 5, catering: 9 })).toBe(5);
    expect(keyColor(keys, 'catering', { catering: 9 })).toBe(1);
    expect(keyColor(keys, 'catering', { catering: -1 })).toBe(7);
    // An id the list does not know: graphite for the administration key, else the first colour.
    expect(keyColor([], ADMIN)).toBeNull();
    expect(keyColor([], 'ghost')).toBe(0);
    expect(keyColorClass(keys, 'admin')).toBe('kc-admin');
    expect(keyColorClass(keys, 'oven', { oven: 3 })).toBe('kc3');
  });

  it('groups keys that share a value, in key order', () => {
    const groups = sameFor(keys, (k) => k.operators_only);
    expect(groups.map((g) => [g.value, g.keys.map((k) => k.id)])).toEqual([
      [false, ['invoices', 'catering', 'oven']],
      [true, ['admin']],
    ]);
    expect(sameFor(keys, (k) => [k.id.length > 4], (a, b) => a[0] === b[0]).map((g) => g.keys.length)).toEqual([3, 1]);
  });

  it('hands stored colours to the views below', () => {
    const colors = { oven: 2 };
    setKeyColors(colors);
    expect(setContext).toHaveBeenCalledWith(KEY_COLORS, colors);
  });

  it('lists labels as a phrase', () => {
    expect(labelList([])).toBe('');
    expect(labelList(['A'])).toBe('A');
    expect(labelList(['A', 'B', 'C'])).toBe('A, B and C');
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
