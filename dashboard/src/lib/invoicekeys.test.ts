import { describe, expect, it } from 'vitest';
import {
  average,
  cutOff,
  daysAgo,
  freeColor,
  idProblem,
  inUse,
  invoiceCount,
  listUrls,
  monthName,
  monthStart,
  nowSecs,
  npubOf,
  openCount,
  percent,
  relayState,
  relayTone,
  shortNpub,
  suggestId,
  sumTotals,
  totalsOf,
  yearStart,
} from './invoicekeys';
import { SHOP_PUBKEY, health, invoiceKey, keyInfosWithShop, shopKey } from '../test-helpers';

// 2026-11-27 12:00 UTC
const NOW = 1_795_780_800;

describe('invoice keys', () => {
  it('suggests an id from a name and says what is wrong with one', () => {
    expect(suggestId('Bread club')).toBe('bread-club');
    expect(suggestId('  2 Café & Co. ')).toBe('cafe-co');
    expect(suggestId('A very long name for a little service')).toBe('a-very-long-name-for-a-l');
    expect(suggestId('abcdefghijklmnopqrstuvw x')).toBe('abcdefghijklmnopqrstuvw');
    expect(idProblem('bread-club', ['invoices'])).toBe('');
    expect(idProblem('B', [])).toMatch(/^Use 2 to 24/);
    expect(idProblem('admin', [])).toBe('There is already a key called admin.');
    expect(idProblem('shop', ['invoices', 'shop'])).toBe('There is already a key called shop.');
  });

  it('picks the first colour no key in use has', () => {
    expect(freeColor([invoiceKey(), shopKey()])).toBe(2);
    // An archived key's colour is free again.
    expect(freeColor([invoiceKey(), shopKey({ archived_at: 1 })])).toBe(1);
    const all = [0, 1, 2, 3, 4, 5, 6, 7].map((c) => shopKey({ id: `k${c}`, color: c }));
    expect(freeColor(all)).toBe(0);
    expect(inUse([invoiceKey(), shopKey({ archived_at: 1 })]).map((k) => k.id)).toEqual(['invoices']);
  });

  it('writes keys as npubs, and a dash for one not loaded yet', () => {
    expect(npubOf('')).toBe('');
    expect(npubOf(SHOP_PUBKEY)).toMatch(/^npub1/);
    expect(shortNpub('')).toBe('—');
    expect(shortNpub(SHOP_PUBKEY)).toMatch(/^npub1.+…/);
  });

  it('works out periods in UTC', () => {
    expect(daysAgo(NOW, 30)).toBe(NOW - 30 * 86_400);
    expect(monthStart(NOW)).toBe(Date.UTC(2026, 10, 1) / 1000);
    expect(yearStart(NOW)).toBe(Date.UTC(2026, 0, 1) / 1000);
    expect(monthName(NOW)).toBe('November');
    expect(Math.abs(nowSecs() - Date.now() / 1000)).toBeLessThan(2);
  });

  it('adds up figures', () => {
    const a = invoiceKey().totals;
    const b = shopKey({}, { last_paid_at: 1_800_000_000 }).totals;
    expect(invoiceCount(a)).toBe(10);
    expect(openCount(a)).toBe(3);
    expect(percent(1, 3)).toBe(33);
    expect(percent(1, 0)).toBe(0);
    expect(average(100, 3)).toBe(33);
    expect(average(100, 0)).toBe(0);
    expect(sumTotals([a, b])).toEqual({ key: '', pending: 3, detected: 1, confirmed: 4, expired: 4, confirmed_sat: 200_000, detected_sat: 50_000, last_paid_at: 1_800_000_000 });
    expect(sumTotals([b, a, invoiceKey({ id: 'x' }, { last_paid_at: null }).totals]).last_paid_at).toBe(1_800_000_000);
    expect(sumTotals([]).last_paid_at).toBeNull();
    expect(totalsOf([invoiceKey()], 'invoices').pending).toBe(2);
    expect(invoiceCount(totalsOf([], 'shop'))).toBe(0);
  });

  it('tells which relays a key uses and which keys are cut off', () => {
    const relays = [
      { url: 'wss://a', status: 'connected', connected: true, keys: ['invoices', 'admin', 'shop'] },
      { url: 'wss://b', status: 'connecting', connected: false, keys: ['shop'] },
    ];
    const h = health({ keys: keyInfosWithShop(), relays });
    expect(relayState(h, 'shop')).toEqual({ urls: ['wss://a', 'wss://b'], connected: 1 });
    expect(relayTone(relayState(h, 'shop'))).toBe('warn');
    expect(relayTone(relayState(h, 'invoices'))).toBe('ok');
    expect(relayTone({ urls: [], connected: 0 })).toBe('bad');
    expect(cutOff(h)).toEqual([]);
    const down = health({ keys: keyInfosWithShop(), relays: [{ ...relays[0], connected: false }, relays[1]] });
    // The original key and the administration key are left to the service's own fall-back.
    expect(cutOff(down)).toEqual([{ id: 'shop', label: 'Shop', urls: ['wss://a', 'wss://b'] }]);
    expect(listUrls([])).toBe('');
    expect(listUrls(['wss://a'])).toBe('wss://a');
    expect(listUrls(['wss://a', 'wss://b', 'wss://c'])).toBe('wss://a, wss://b and wss://c');
  });
});
