import { afterEach, describe, expect, it } from 'vitest';
import { health, keyInfosWithShop, relayHistory, relayStats } from '../test-helpers';
import type { KeyInfo } from './schemas';
import { coverage, DEFAULT_VIEW, groupRows, loadRelayView, msText, networkOf, rateTone, relayRows, saveRelayView, servesText, shortHost } from './relayview';

afterEach(() => localStorage.clear());

const key = (id: string, label: string): KeyInfo => ({ id, label, pubkey: '', tools: [], operators_only: false, relays: [] });

describe('the relay view pick', () => {
  it('is kept in local storage, and anything else stored gives the default', () => {
    expect(loadRelayView()).toBe(DEFAULT_VIEW);
    saveRelayView('coverage');
    expect(loadRelayView()).toBe('coverage');
    localStorage.setItem('deadhop.relay-view', 'nonsense');
    expect(loadRelayView()).toBe(DEFAULT_VIEW);
  });

  it('survives a storage that refuses to be read or written', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } } as unknown as Storage;
    expect(loadRelayView(broken)).toBe(DEFAULT_VIEW);
    expect(() => saveRelayView('rows', broken)).not.toThrow();
  });
});

describe('relay addresses', () => {
  it('name the network by the host', () => {
    expect(networkOf('wss://relay.example')).toBe('Clearnet');
    expect(networkOf('ws://abc.onion/')).toBe('Tor');
    expect(networkOf('ws://ABC.b32.i2p')).toBe('I2P');
    expect(networkOf('ws://node.fips.')).toBe('FIPS');
    expect(networkOf('ws://127.0.0.1:7777')).toBe('This machine');
    expect(networkOf('ws://localhost:7777')).toBe('This machine');
    expect(networkOf('ws://[::1]:7777')).toBe('This machine');
    expect(networkOf('not an address')).toBe('Clearnet');
  });

  it('drop the scheme and cut long hosts in the middle', () => {
    expect(shortHost('wss://relay.example/')).toBe('relay.example');
    expect(shortHost('ws://paresiah7gsmksmsmisnrd5ujfyay4u4daq6wrkyo3qdltfs6rcyywyd.onion/')).toBe('paresiah7gsm…fs6rcyywyd.onion');
  });

  it('show a round trip with a thousands separator, or a dash', () => {
    expect(msText(1958)).toBe('1,958 ms');
    expect(msText(null)).toBe('—');
  });
});

describe('error rates', () => {
  it('are quiet below 1%, and otherwise keep the shared tone', () => {
    expect(rateTone(null)).toBe('none');
    expect(rateTone({ failed: 1, total: 200, text: '0.5%', tone: 'warn' })).toBe('quiet');
    expect(rateTone({ failed: 1, total: 40, text: '2.5%', tone: 'warn' })).toBe('warn');
    expect(rateTone({ failed: 0, total: 40, text: '0%', tone: 'ok' })).toBe('ok');
    expect(rateTone({ failed: 30, total: 40, text: '75%', tone: 'bad' })).toBe('bad');
  });
});

describe('relay rows', () => {
  it('take the check, the history and the keys of each relay', () => {
    const h = health({
      keys: keyInfosWithShop(),
      relays: [
        { url: 'ws://127.0.0.1:7777', status: 'connected', connected: true, keys: [] },
        { url: 'wss://shop.example', status: 'connected', connected: true, keys: ['shop', 'invoices'] },
        { url: 'wss://gone.example', status: 'disconnected', connected: false, keys: ['admin'] },
      ],
      relay_health: [
        { relay: 'ws://127.0.0.1:7777/', status: 'ok', connects: true, forwards: true, rate_limited: false, ms: 84, detail: '', checked_at: 1 },
        { relay: 'wss://shop.example', status: 'degraded', connects: true, forwards: false, rate_limited: true, ms: null, detail: 'rate-limited', checked_at: 1 },
      ],
    });
    const history = relayHistory({ relays: [relayStats({ relay: 'wss://shop.example', avg_ms: 300, checks: 10, check_failures: 9, sends: 0, send_failures: 0 })] });
    const [local, shop, gone] = relayRows(h, history);
    expect(local).toMatchObject({ host: '127.0.0.1:7777', network: 'This machine', keys: ['admin', 'invoices', 'shop'], every: true, tone: 'ok', note: '', ms: 84, stats: null, rate: null, rateTone: 'none', problem: false });
    expect(shop).toMatchObject({ keys: ['invoices', 'shop'], every: false, tone: 'warn', note: 'rate-limited', ms: 300, rateTone: 'bad', problem: true });
    expect(gone).toMatchObject({ connected: false, status: 'disconnected', tone: 'bad', note: 'not checked yet', ms: null, problem: true });
    expect(relayRows(health(), null)[0].problem).toBe(false);
  });

  it('say which keys use a relay in a few words', () => {
    const keys = [...keyInfosWithShop(), key('a', 'A'), key('b', 'B')];
    expect(servesText({ keys: [], every: true }, keys)).toBe('All keys');
    expect(servesText({ keys: ['admin'], every: false }, keys)).toBe('Administration');
    expect(servesText({ keys: ['invoices', 'shop', 'a'], every: false }, keys)).toBe('3 keys, not Administration and B');
    expect(servesText({ keys: ['invoices', 'shop'], every: false }, keys)).toBe('2 keys');
    expect(servesText({ keys: ['gone'], every: false }, keys)).toBe('gone');
  });

  it('group by the keys they serve, every key first, and count each key’s connected relays', () => {
    const h = health({
      keys: keyInfosWithShop(),
      relays: [
        { url: 'wss://admin.example', status: 'connected', connected: true, keys: ['admin'] },
        { url: 'wss://two.example', status: 'connected', connected: true, keys: ['invoices', 'shop'] },
        { url: 'wss://all.example', status: 'disconnected', connected: false, keys: ['admin', 'invoices', 'shop'] },
        { url: 'wss://two-b.example', status: 'connected', connected: true, keys: ['shop', 'invoices'] },
      ],
    });
    const rows = relayRows(h, null);
    expect(groupRows(rows, h.keys).map((g) => [g.title, g.keys, g.rows.length, g.connected])).toEqual([
      ['All keys', [], 1, 0],
      ['2 keys', ['invoices', 'shop'], 2, 2],
      ['Administration only', [], 1, 1],
    ]);
    expect(coverage(rows, h.keys)).toEqual([
      { id: 'admin', connected: 1, total: 2, tone: 'warn' },
      { id: 'invoices', connected: 2, total: 3, tone: 'warn' },
      { id: 'shop', connected: 2, total: 3, tone: 'warn' },
    ]);
    const lone = relayRows(health({ relays: [{ url: 'wss://a', status: 'connecting', connected: false, keys: ['admin'] }] }), null);
    expect(coverage(lone, keyInfosWithShop()).map((c) => c.tone)).toEqual(['bad', 'bad', 'bad']);
    expect(coverage(relayRows(health(), null), health().keys).map((c) => c.tone)).toEqual(['ok', 'ok']);
  });
});
