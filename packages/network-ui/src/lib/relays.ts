// Helpers for the relay history: windows, matching a relay by address, error rates.
import type { I2pLookup, RelayHistory, RelayStats } from './schemas';

export type HistoryWindow = RelayHistory['window'];

export const WINDOWS: { value: HistoryWindow; label: string }[] = [
  { value: '15m', label: '15 min' },
  { value: '1h', label: '1 hour' },
  { value: '12h', label: '12 hours' },
  { value: '1d', label: '1 day' },
  { value: '1w', label: '1 week' },
];

const bare = (url: string) => url.replace(/\/$/, '');

/** One relay's results in a history, matched by address (a trailing slash does not matter). */
export function statsFor(history: RelayHistory | null, url: string): RelayStats | null {
  return history?.relays.find((s) => bare(s.relay) === bare(url)) ?? null;
}

export interface ErrorRate {
  failed: number;
  total: number;
  /** `0%`, `2.5%`, `100%`, or a dash when nothing was recorded. */
  text: string;
  /** Green with no failures, orange with a few, red with many; none without data. */
  tone: 'ok' | 'warn' | 'bad' | 'none';
}

/** Failed health checks and failed replies, together, out of everything recorded. */
export function errorRate(s: RelayStats): ErrorRate {
  const total = s.checks + s.sends;
  const failed = s.check_failures + s.send_failures;
  if (total === 0) return { failed, total, text: '—', tone: 'none' };
  const share = (100 * failed) / total;
  const text = `${failed > 0 && share < 10 ? share.toFixed(1) : Math.round(share)}%`;
  return { failed, total, text, tone: failed === 0 ? 'ok' : share < 20 ? 'warn' : 'bad' };
}

/** Whether a host is on a network that encrypts the whole path itself: Tor, I2P or FIPS. */
export const isOverlayHost = (host: string) => /\.(onion|i2p|fips)$/.test(host.replace(/\.$/, '').toLowerCase());

const isLoopbackHost = (host: string) => {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127(\.\d{1,3}){3}$/.test(h);
};

/**
 * Why a relay address cannot be used, or an empty string. The same rules as the
 * service (so a refused address is caught here, with the reason, instead of on
 * save): wss:// everywhere, and plain ws:// on mainnet only for this machine or
 * for Tor, I2P and FIPS addresses, which encrypt the connection themselves.
 */
export function relayProblem(url: string, network: string, listed: string[]): string {
  if (!/^wss?:\/\//.test(url)) return 'A relay address starts with wss:// (or ws:// for a relay on this machine, or on Tor, I2P or FIPS).';
  if (/\s/.test(url)) return 'A relay address has no spaces.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `'${url}' is not a valid relay address.`;
  }
  if (parsed.username !== '' || parsed.password !== '') return 'A relay address must not contain a user name or password.';
  if (network === 'bitcoin' && url.startsWith('ws://') && !isLoopbackHost(parsed.hostname) && !isOverlayHost(parsed.hostname)) {
    return 'On mainnet a relay must use wss://. Plain ws:// is only for this machine, or for .onion, .i2p and .fips addresses.';
  }
  if (listed.some((r) => bare(r) === bare(url))) return 'That relay is already listed.';
  return '';
}

const HOST = /^(wss?:\/\/)([^/:?#]+)(.*)$/;

/**
 * The I2P name in a relay address (`ws://nostr-not.i2p` gives `nostr-not.i2p`),
 * or null when its host is not one: a `.b32.i2p` address is not a name.
 */
export function i2pName(url: string): string | null {
  const host = HOST.exec(url.trim())?.[2].toLowerCase() ?? '';
  return host.endsWith('.i2p') && !host.endsWith('.b32.i2p') ? host : null;
}

/** The relay address with another host; the scheme, port and path stay. */
export const withHost = (url: string, host: string) => url.trim().replace(HOST, (_, scheme: string, _host: string, rest: string) => `${scheme}${host}${rest}`);

/** A registry address as its host: `http://notbob.i2p/cgi-bin/…` is `notbob.i2p`. */
export const registryHost = (r: string) => r.replace(/^http:\/\//, '').split(/[/?]/)[0];

const listOf = (hosts: string[]) => (hosts.length < 2 ? hosts.join('') : `${hosts.slice(0, -1).join(', ')} and ${hosts[hosts.length - 1]}`);

/** What a lookup found, in one line: `nostr-not.i2p → <b32> (from notbob.i2p; stats.i2p doesn't know it)`. */
export function lookupLine(l: I2pLookup): string {
  const from = l.agreeing.map(registryHost);
  const unknown = l.unknown.map(registryHost);
  const notes = [`from ${listOf(from)}`, ...(unknown.length === 0 ? [] : [`${listOf(unknown)} ${unknown.length === 1 ? "doesn't" : "don't"} know it`])];
  return `${l.name} → ${l.address} (${notes.join('; ')})`;
}
