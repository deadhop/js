// Routing rules, as the service applies them (server/src/routes.rs). The
// service decides the live routes and reports them in health; this copy is for
// what the page has to work out before saving: the route of a relay being
// added, the preview of a rule being edited, and the guards on a save. The
// pattern cases in fixtures/route-patterns.json run against both copies.
import type { ProxySettings, Rule, RouteReason, RouteTo, Settings } from './schemas';

export const MAX_RULES = 16;
export const MAX_PATTERNS = 16;

/** The host (lower case, no IPv6 brackets) and port of a relay address, as a URL parser reads them. */
export function hostPort(relay: string): { host: string; port: number } | null {
  let url: URL;
  try {
    url = new URL(relay);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = url.port !== '' ? Number(url.port) : url.protocol === 'ws:' ? 80 : 443;
  return { host, port };
}

/** `*` matches any run of characters (dots included); everything else is literal. */
function glob(pattern: string, text: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return re.test(text);
}

/** A host pattern split into its host part and optional port. */
function splitPort(pattern: string): [string, string | null] {
  if (pattern.startsWith('[')) {
    const end = pattern.indexOf(']');
    if (end < 0) return [pattern, null];
    const tail = pattern.slice(end + 1);
    return [pattern.slice(1, end), tail.startsWith(':') ? tail.slice(1) : null];
  }
  const at = pattern.lastIndexOf(':');
  return at < 0 ? [pattern, null] : [pattern.slice(0, at), pattern.slice(at + 1)];
}

const bare = (url: string) => url.replace(/\/+$/, '').toLowerCase();

/** Whether `pattern` matches `relay`: an exact address (with `://`) or a host pattern with an optional port. */
export function matches(pattern: string, relay: string): boolean {
  const p = pattern.trim();
  if (p.includes('://')) return bare(p) === bare(relay);
  const hp = hostPort(relay);
  if (hp === null) return false;
  const [host, port] = splitPort(p.toLowerCase());
  if (port !== null && Number(port) !== hp.port) return false;
  return glob(host, hp.host);
}

/** Why a pattern cannot be used, or an empty string. */
export function patternProblem(pattern: string): string {
  const p = pattern.trim();
  if (p === '') return 'A pattern is empty.';
  if (p.length > 256) return `Pattern '${p}' is too long.`;
  if (p.includes('://')) return /^wss?:\/\//.test(p) && hostPort(p) !== null ? '' : `'${p}' is not a relay address (ws:// or wss://).`;
  if (!/^[A-Za-z0-9.\-_*:[\]]+$/.test(p)) return `Pattern '${p}' may hold only letters, digits, '.', '-', '_', '*' and a ':port'.`;
  const [, port] = splitPort(p);
  if (port !== null && !(/^\d{1,5}$/.test(port) && Number(port) <= 65535)) return `Pattern '${p}' has a port that is not a number.`;
  return '';
}

const tld = (host: string) => host.replace(/\.$/, '');

/** Whether a relay must never be connected without a proxy (Tor or I2P). */
export function neverDirect(relay: string): boolean {
  const hp = hostPort(relay);
  return hp !== null && /\.(onion|i2p)$/.test(tld(hp.host));
}

/** Whether a relay is on this machine, a private network, or Tor, I2P or FIPS: reaching it straight does not show this machine's address to the internet. */
export function isLocalOrOverlay(relay: string): boolean {
  const hp = hostPort(relay);
  if (hp === null) return true;
  const h = tld(hp.host);
  if (/\.(onion|i2p|fips)$/.test(h)) return true;
  if (h.includes(':')) return h === '::1' || /^(fc|fd)[0-9a-f]{2}:|^fe80:/.test(h);
  if (h === 'localhost' || !h.includes('.') || /\.(local|lan|home\.arpa|internal)$/.test(h)) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.\d+\.\d+$/);
  if (v4 === null) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** Whether a (checked, valid) pattern can only match Tor or I2P relays. */
function namesTorOrI2p(pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  const host = p.includes('://') ? hostPort(p)!.host : splitPort(p)[0];
  return /\.(onion|i2p)$/.test(tld(host));
}

const applies = (r: Rule, key: string, relay: string) => (r.keys.length === 0 || r.keys.includes(key)) && r.match.some((p) => matches(p, relay));

/** Index of the first rule that applies to `key` and matches `relay`, or -1. */
export const firstRule = (rules: Rule[], key: string, relay: string) => rules.findIndex((r) => applies(r, key, relay));

/** The relays one key connects to, in list order. */
function relaysFor(s: Pick<Settings, 'relays' | 'relay_keys'>, key: string, ids: string[]): string[] {
  return s.relays.filter((r) => {
    const found = Object.entries(s.relay_keys).find(([u]) => bare(u) === bare(r));
    const users = found === undefined || found[1].length === 0 ? ids : found[1];
    return users.includes(key);
  });
}

/** A key's default route now: the pool's proxy (by id), straight, or nothing. */
export type DefaultRoute = { proxy: string } | 'direct' | 'off';

/** Where one relay goes: a proxy id, straight, or nowhere; and why. */
export interface Route {
  relay: string;
  /** Index of the rule that matched, or -1 for the default route. */
  rule: number;
  via: { proxy: string } | 'direct' | 'off';
  reason: RouteReason;
}

/** Where each of `key`'s relays goes (the service's resolve). `up` says whether a proxy answered its last probe. */
export function resolve(s: Pick<Settings, 'relays' | 'relay_keys' | 'proxies'>, key: string, ids: string[], fallbackRoute: DefaultRoute, up: (id: string) => boolean): Route[] {
  const { rules, list, transparent } = s.proxies;
  return relaysFor(s, key, ids).map((relay) => {
    const i = firstRule(rules, key, relay);
    const rule = i < 0 ? null : rules[i];
    const onDefault = (reason: RouteReason): Pick<Route, 'via' | 'reason'> => (fallbackRoute === 'off' ? { via: 'off', reason: 'pool_offline' } : { via: fallbackRoute, reason });
    let r: Pick<Route, 'via' | 'reason'>;
    if (rule?.to === 'block') r = { via: 'off', reason: 'blocked' };
    else if (transparent) r = { via: 'direct', reason: 'transparent' };
    else if (rule === null) r = onDefault('default');
    else if (rule.to === 'pool') r = onDefault('rule');
    else if (rule.to === 'direct') r = { via: 'direct', reason: 'rule' };
    else {
      const id = rule.to.proxy;
      // "Stay offline" means never another way: it always goes through its proxy (and keeps retrying there).
      if (list.some((e) => e.id === id) && (up(id) || rule.fallback === 'offline')) r = { via: { proxy: id }, reason: 'rule' };
      else if (rule.fallback === 'pool') r = onDefault('fallback');
      else r = { via: 'off', reason: 'proxy_down' };
    }
    if (r.via === 'direct' && neverDirect(relay) && !transparent) r = { via: 'off', reason: 'never_direct' };
    return { relay, rule: i, ...r };
  });
}

/** Whether some relay of `key` may take the default route. */
export function usesDefault(s: Pick<Settings, 'relays' | 'relay_keys' | 'proxies'>, key: string, ids: string[]): boolean {
  const rules = s.proxies.rules;
  return relaysFor(s, key, ids).some((relay) => {
    const i = firstRule(rules, key, relay);
    if (i < 0) return true;
    const to = rules[i].to;
    return to === 'pool' || (typeof to === 'object' && rules[i].fallback === 'pool');
  });
}

/** Why the rule list cannot be saved, or an empty string (the service's checks, and this page's own way in). */
export function rulesProblem(
  s: Pick<Settings, 'relays' | 'relay_keys' | 'proxies'>,
  keys: { id: string; label: string }[],
  savedProxies: ProxySettings['list'],
  dashboardRelays: string[],
): string {
  const rules = s.proxies.rules;
  const ids = keys.map((k) => k.id);
  if (rules.length > MAX_RULES) return `At most ${MAX_RULES} routing rules.`;
  for (const [i, r] of rules.entries()) {
    const n = i + 1;
    if (r.match.length === 0 || r.match.length > MAX_PATTERNS) return `Rule ${n}: between 1 and ${MAX_PATTERNS} relays or patterns are required.`;
    const bad = r.match.map(patternProblem).find((p) => p !== '');
    if (bad !== undefined) return `Rule ${n}: ${bad}`;
    if (typeof r.to === 'object') {
      const id = r.to.proxy;
      if (!s.proxies.list.some((e) => e.id === id)) return `Rule ${n} goes through a proxy that is no longer listed. Change the rule first.`;
      if (!savedProxies.some((e) => e.id === id)) return `Rule ${n} goes through a proxy that is not saved yet. Save the proxy first.`;
    }
    if (r.to === 'direct' && r.match.some(namesTorOrI2p)) return `Rule ${n}: Tor and I2P relays can only be reached through a proxy, never directly.`;
  }
  for (const k of keys) {
    const relays = relaysFor(s, k.id, ids);
    const open = relays.some((relay) => {
      const i = firstRule(rules, k.id, relay);
      return i < 0 || rules[i].to !== 'block';
    });
    if (relays.length > 0 && !open) return `The rules block every relay of ${k.label}: it could not be reached.`;
  }
  const admin = keys.find((k) => k.id === 'admin');
  if (admin !== undefined && dashboardRelays.length > 0) {
    const mine = relaysFor(s, admin.id, ids).filter((r) => dashboardRelays.some((d) => bare(d) === bare(r)));
    const reachable = mine.some((relay) => {
      const i = firstRule(rules, admin.id, relay);
      return i < 0 || rules[i].to !== 'block';
    });
    if (mine.length > 0 && !reachable) return `The rules block every relay this page signs in through for ${admin.label}: you would be locked out.`;
  }
  return '';
}

/** A rule's destination in words. */
export function destination(to: RouteTo, list: ProxySettings['list']): string {
  if (to === 'pool') return 'The default route';
  if (to === 'direct') return 'Direct, no proxy';
  if (to === 'block') return 'Nowhere: blocked';
  const e = list.find((p) => p.id === to.proxy);
  return e === undefined ? 'A proxy that is no longer listed' : proxyName(e);
}

/** A proxy's label, or its address when it has none. */
export const proxyName = (e: { name: string; url: string }) => (e.name === '' ? e.url : e.name);

/** Why a relay goes the way it does, in words. */
export const REASONS: Record<RouteReason, string> = {
  rule: 'by the rule',
  default: 'default route',
  fallback: 'fallback: the rule’s proxy is down',
  proxy_down: 'offline: the rule\u2019s proxy is no longer listed',
  blocked: 'blocked by the rule',
  pool_offline: 'offline: no proxy in the default route is reachable',
  never_direct: 'offline: Tor and I2P relays are never reached directly',
  transparent: 'straight to the transparent proxy',
};

/** A new rule with nothing filled in. */
export const newRule = (): Rule => ({ name: '', match: [], keys: [], to: 'pool', fallback: 'offline' });
