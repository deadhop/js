// The Relays card on the overview: one model of each relay, shared by the five
// ways the card can show them, and the way this browser last picked.
import { displayOrder, labelList, usersOf } from '@deadhop/network-ui/lib/keys';
import { errorRate, statsFor, type ErrorRate } from '@deadhop/network-ui/lib/relays';
import type { Health, KeyInfo, RelayHealth, RelayHistory, RelayStats } from './schemas';

export type RelayView = 'columns' | 'rows' | 'groups' | 'problems' | 'coverage';

export const RELAY_VIEWS: { value: RelayView; label: string }[] = [
  { value: 'columns', label: 'Columns' },
  { value: 'rows', label: 'Rows' },
  { value: 'groups', label: 'By keys' },
  { value: 'problems', label: 'Problems first' },
  { value: 'coverage', label: 'Key coverage' },
];

export const DEFAULT_VIEW: RelayView = 'columns';
const KEY = 'deadhop.relay-view';

const isView = (v: unknown): v is RelayView => RELAY_VIEWS.some((x) => x.value === v);

/** The view this browser picked last, or the default. */
export function loadRelayView(store: Storage = localStorage): RelayView {
  try {
    const v = store.getItem(KEY);
    return isView(v) ? v : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveRelayView(view: RelayView, store: Storage = localStorage): void {
  try {
    store.setItem(KEY, view);
  } catch {
    // Storage refused (private mode, quota): the pick lasts for this page only.
  }
}

export type Network = 'Clearnet' | 'Tor' | 'I2P' | 'FIPS' | 'This machine';
export type Tone = 'ok' | 'warn' | 'bad';
/** An error rate's colour: `quiet` is a few failures (under 1%), shown muted rather than as a warning. */
export type RateTone = ErrorRate['tone'] | 'quiet';

export interface RelayRow {
  url: string;
  /** The address without its scheme and trailing slash, long hosts cut in the middle. */
  host: string;
  network: Network;
  /** The keys that use it, in display order. */
  keys: string[];
  /** Every key uses it. */
  every: boolean;
  connected: boolean;
  /** The live connection's state, as the service names it (`connected`, `connecting`, …). */
  status: string;
  /** The dot: the last end-to-end check, or the live connection before any check. */
  tone: Tone;
  /** What is wrong, `not checked yet`, or empty. */
  note: string;
  /** The last check's round trip, else the day's average. */
  ms: number | null;
  stats: RelayStats | null;
  rate: ErrorRate | null;
  rateTone: RateTone;
  /** Not connected, a failing check, or many errors. */
  problem: boolean;
}

const bare = (u: string) => u.replace(/\/$/, '');
const DOT: Record<RelayHealth['status'], Tone> = { ok: 'ok', degraded: 'warn', down: 'bad' };
const LONG = 34;

/** The network a relay address is on, by its host. */
export function networkOf(url: string): Network {
  const host = (/^wss?:\/\/(\[[^\]]+\]|[^/:?#]+)/.exec(url)?.[1] ?? '').toLowerCase().replace(/\.$/, '');
  if (host.endsWith('.onion')) return 'Tor';
  if (host.endsWith('.i2p')) return 'I2P';
  if (host.endsWith('.fips')) return 'FIPS';
  if (host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host)) return 'This machine';
  return 'Clearnet';
}

/** `wss://relay.example/` as `relay.example`; an onion or b32 address as `paresiah7gsm…rcyywyd.onion`. */
export function shortHost(url: string): string {
  const s = bare(url).replace(/^wss?:\/\//, '');
  return s.length <= LONG ? s : `${s.slice(0, 12)}…${s.slice(-16)}`;
}

/** An error rate's tone, calmer than the Network page's below 1%. */
export function rateTone(rate: ErrorRate | null): RateTone {
  if (rate === null) return 'none';
  return rate.tone === 'warn' && (100 * rate.failed) / rate.total < 1 ? 'quiet' : rate.tone;
}

/** Every relay of the service, in its order, for the card. */
export function relayRows(h: Health, history: RelayHistory | null): RelayRow[] {
  const order = displayOrder(h.keys).map((k) => k.id);
  return h.relays.map((r) => {
    const check = h.relay_health.find((c) => bare(c.relay) === bare(r.url)) ?? null;
    const stats = statsFor(history, r.url);
    const rate = stats === null ? null : errorRate(stats);
    const users = usersOf(r.keys, order);
    const tone: Tone = check === null ? (r.connected ? 'ok' : 'bad') : DOT[check.status];
    const tones = rateTone(rate);
    return {
      url: r.url,
      host: shortHost(r.url),
      network: networkOf(r.url),
      keys: order.filter((id) => users.includes(id)),
      every: order.every((id) => users.includes(id)),
      connected: r.connected,
      status: r.status,
      tone,
      note: check === null ? 'not checked yet' : check.status === 'ok' ? '' : check.detail,
      ms: check?.ms ?? stats?.avg_ms ?? null,
      stats,
      rate,
      rateTone: tones,
      problem: !r.connected || tone !== 'ok' || tones === 'bad',
    };
  });
}

const labelOf = (keys: KeyInfo[], id: string) => keys.find((k) => k.id === id)?.label ?? id;

/** Which keys use a relay, in a few words: `All keys`, `Administration`, `6 keys, not Administration`, `3 keys`. */
export function servesText(row: Pick<RelayRow, 'keys' | 'every'>, keys: KeyInfo[]): string {
  if (row.every) return 'All keys';
  if (row.keys.length === 1) return labelOf(keys, row.keys[0]);
  const missing = displayOrder(keys).filter((k) => !row.keys.includes(k.id));
  return missing.length <= 2 ? `${row.keys.length} keys, not ${labelList(missing.map((k) => k.label))}` : `${row.keys.length} keys`;
}

export interface RelayGroup {
  title: string;
  /** The keys to name under the title: none when the title says it. */
  keys: string[];
  rows: RelayRow[];
  connected: number;
}

/** The relays grouped by the keys that use them: all keys first, then the larger sets. */
export function groupRows(rows: RelayRow[], keys: KeyInfo[]): RelayGroup[] {
  const groups: RelayGroup[] = [];
  for (const row of rows) {
    const found = groups.find((g) => g.rows[0].keys.join(' ') === row.keys.join(' '));
    if (found === undefined) groups.push({ title: '', keys: [], rows: [row], connected: 0 });
    else found.rows.push(row);
  }
  for (const g of groups) {
    const first = g.rows[0];
    g.connected = g.rows.filter((r) => r.connected).length;
    if (first.every) g.title = 'All keys';
    else if (first.keys.length === 1) g.title = `${labelOf(keys, first.keys[0])} only`;
    else {
      g.title = `${first.keys.length} keys`;
      g.keys = first.keys;
    }
  }
  return groups.sort((a, b) => Number(b.rows[0].every) - Number(a.rows[0].every) || b.rows[0].keys.length - a.rows[0].keys.length);
}

/** How many connected relays each key has, out of its relays: the same count as the Invoice keys table. */
export function coverage(rows: RelayRow[], keys: KeyInfo[]): { id: string; connected: number; total: number; tone: Tone }[] {
  return displayOrder(keys).map((k) => {
    const mine = rows.filter((r) => r.keys.includes(k.id));
    const connected = mine.filter((r) => r.connected).length;
    return { id: k.id, connected, total: mine.length, tone: connected === 0 ? 'bad' : connected < mine.length ? 'warn' : 'ok' };
  });
}

/** A round trip as text: `1,958 ms`, or a dash. */
export const msText = (ms: number | null) => (ms === null ? '—' : `${ms.toLocaleString('en')} ms`);
