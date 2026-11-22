// Helpers for the relay history: windows, matching a relay by address, error rates.
import type { RelayHistory, RelayStats } from './schemas';

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
