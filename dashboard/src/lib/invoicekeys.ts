// What the dashboard works out about invoice keys: colours, ids, periods,
// relays and figures. Kept out of the components so each rule is tested once.
import { nip19 } from 'nostr-tools';
import { shortKey } from '@deadhop/network-ui/lib/format';
import type { Health, InvoiceKeyInfo, KeyTotals } from './schemas';
import { COLOR_NAMES } from './keycolors';

/** The first colour no key in use has, else the first one. */
export function freeColor(keys: InvoiceKeyInfo[]): number {
  const used = new Set(inUse(keys).map((k) => k.color));
  const free = COLOR_NAMES.findIndex((_, i) => !used.has(i));
  return free === -1 ? 0 : free;
}

/** The keys that are not archived. */
export const inUse = (keys: InvoiceKeyInfo[]) => keys.filter((k) => k.archived_at === null);

/** An id for a key named `label`: lower-case letters, digits and dashes, starting with a letter, at most 24. */
export function suggestId(label: string): string {
  return label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 24)
    .replace(/-+$/, '');
}

/** Why `id` cannot be a new key's id, or an empty string. */
export function idProblem(id: string, taken: string[]): string {
  if (!/^[a-z][a-z0-9-]{1,23}$/.test(id)) return 'Use 2 to 24 lower-case letters, digits or dashes, starting with a letter.';
  if (id === 'admin' || taken.includes(id)) return `There is already a key called ${id}.`;
  return '';
}

/** The npub of a hex key; empty while the service has not loaded it. */
export const npubOf = (hex: string): string => (hex === '' ? '' : nip19.npubEncode(hex));

/** A short npub to show in a table, or a dash while the key is not loaded. */
export const shortNpub = (hex: string): string => (hex === '' ? '—' : shortKey(npubOf(hex)));

const DAY = 86_400;

/** Unix seconds `days` days before `now`. */
export const daysAgo = (now: number, days: number) => now - days * DAY;

/** The start of the UTC month `now` is in. */
export function monthStart(now: number): number {
  const d = new Date(now * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
}

/** The start of the UTC year `now` is in. */
export function yearStart(now: number): number {
  return Date.UTC(new Date(now * 1000).getUTCFullYear(), 0, 1) / 1000;
}

/** The name of the UTC month `now` is in. */
export const monthName = (now: number) => new Date(now * 1000).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });

/** Now, in unix seconds. */
export const nowSecs = () => Math.floor(Date.now() / 1000);

/** All of a key's invoices. */
export const invoiceCount = (t: KeyTotals) => t.pending + t.detected + t.confirmed + t.expired;

/** A key's open invoices (waiting for payment or confirming): they count towards the service's open limit. */
export const openCount = (t: KeyTotals) => t.pending + t.detected;

/** `part` as a whole percentage of `whole` (0 when there is nothing). */
export const percent = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part * 100) / whole));

/** The average paid amount, in whole sats (0 when nothing was paid). */
export const average = (sat: number, n: number) => (n === 0 ? 0 : Math.round(sat / n));

/** The totals of several keys added up. */
export function sumTotals(list: KeyTotals[]): KeyTotals {
  const latest = list.reduce<number | null>((a, t) => (t.last_paid_at !== null && (a === null || t.last_paid_at > a) ? t.last_paid_at : a), null);
  const add = (f: 'pending' | 'detected' | 'confirmed' | 'expired' | 'confirmed_sat' | 'detected_sat') => list.reduce((a, t) => a + t[f], 0);
  return {
    key: '',
    pending: add('pending'),
    detected: add('detected'),
    confirmed: add('confirmed'),
    expired: add('expired'),
    confirmed_sat: add('confirmed_sat'),
    detected_sat: add('detected_sat'),
    last_paid_at: latest,
  };
}

/** A key's totals in a list, or zeros when the list has no such key. */
export function totalsOf(keys: InvoiceKeyInfo[], id: string): KeyTotals {
  return keys.find((k) => k.id === id)?.totals ?? sumTotals([]);
}

/** The relays a key uses, and how many of them are connected now. */
export function relayState(h: Health, id: string): { urls: string[]; connected: number } {
  const mine = h.relays.filter((r) => r.keys.includes(id));
  return { urls: mine.map((r) => r.url), connected: mine.filter((r) => r.connected).length };
}

/** The dot beside "X of Y connected": all, some or none. */
export const relayTone = (s: { urls: string[]; connected: number }) => (s.connected === 0 ? 'bad' : s.connected < s.urls.length ? 'warn' : 'ok');

/** Added invoice keys (not the original one, not archived) with no relay connected. */
export function cutOff(h: Health): { id: string; label: string; urls: string[] }[] {
  return h.keys
    .filter((k) => !k.operators_only && k.id !== 'invoices')
    .map((k) => ({ id: k.id, label: k.label, ...relayState(h, k.id) }))
    .filter((k) => k.connected === 0)
    .map(({ id, label, urls }) => ({ id, label, urls }));
}

/** How a key's relays are listed in a sentence: "wss://a", "wss://a and wss://b", "wss://a, wss://b and wss://c". */
export function listUrls(urls: string[]): string {
  return urls.length <= 1 ? urls.join('') : `${urls.slice(0, -1).join(', ')} and ${urls[urls.length - 1]}`;
}
