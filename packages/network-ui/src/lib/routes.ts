// Routing rules, as the service applies them (deadhop/server crates/netengine/src/routes.rs). The
// service decides the live routes and reports them in health; this copy is for
// what the page has to work out before saving: the route of a relay being
// added, the preview of a rule being edited, and the guards on a save. The
// pattern cases in fixtures/route-patterns.json run against both copies.
import type { Destination, Fallback, KeyInfo, NetworkSettings, OfflinePolicy, ProxyPool, ProxySettings, RouteReason, Rule } from './schemas';

export const MAX_RULES = 32;
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
function relaysFor(s: Pick<NetworkSettings, 'relays' | 'relay_keys'>, key: string, ids: string[]): string[] {
  return s.relays.filter((r) => {
    const found = Object.entries(s.relay_keys).find(([u]) => bare(u) === bare(r));
    const users = found === undefined || found[1].length === 0 ? ids : found[1];
    return users.includes(key);
  });
}

/** Where one relay goes: a proxy id, straight, or nowhere; and why. */
export interface Route {
  relay: string;
  /** Index of the rule that matched, or -1 for the default route. */
  rule: number;
  via: { proxy: string } | 'direct' | 'off';
  reason: RouteReason;
}

/** Whether two destinations are the same. */
export const sameDestination = (a: Destination, b: Destination) => JSON.stringify(a) === JSON.stringify(b);

/** Where the relays of `key` that no rule matches go. */
export const defaultFor = (p: Pick<ProxySettings, 'default' | 'default_keys'>, key: string): Destination => p.default_keys[key] ?? p.default;

/**
 * Where each of `key`'s relays goes (the service's resolve). `now` gives the
 * proxy (id) a proxy or group destination uses now, or null while it has
 * nothing reachable. `offline` is what the offline policy means for the key:
 * connect straight (true) or stay off (false); null before anything was
 * checked, when the key waits.
 */
export function resolve(s: Pick<NetworkSettings, 'relays' | 'relay_keys' | 'proxies'>, key: string, ids: string[], now: (d: Destination) => string | null, offline: boolean | null): Route[] {
  const p = s.proxies;
  const { rules, transparent } = p;
  type Way = Pick<Route, 'via' | 'reason'>;
  const policy = (reason: RouteReason): Way => (offline === true ? { via: 'direct', reason } : { via: 'off', reason: 'pool_offline' });
  const go = (d: Destination, reason: RouteReason): Way | null => {
    if (d === 'direct') return { via: 'direct', reason };
    if (d === 'block') return { via: 'off', reason: 'blocked' };
    const id = now(d);
    return id === null ? null : { via: { proxy: id }, reason };
  };
  return relaysFor(s, key, ids).map((relay) => {
    const i = firstRule(rules, key, relay);
    const rule = i < 0 ? null : rules[i];
    let r: Way;
    // A block (a rule's, or the default route's) wins even behind a transparent proxy.
    if (rule?.to === 'block' || (rule === null && defaultFor(p, key) === 'block')) r = { via: 'off', reason: 'blocked' };
    else if (transparent) r = { via: 'direct', reason: 'transparent' };
    else if (rule === null) r = go(defaultFor(p, key), 'default') ?? policy('default');
    else r = go(rule.to, 'rule') ?? fallen(rule, p, go, policy);
    if (r.via === 'direct' && neverDirect(relay) && !transparent) r = { via: 'off', reason: 'never_direct' };
    return { relay, rule: i, ...r };
  });
}

/** Where a rule's relays go while its proxy or group has nothing reachable. */
function fallen(
  rule: Rule,
  p: ProxySettings,
  go: (d: Destination, reason: RouteReason) => Pick<Route, 'via' | 'reason'> | null,
  policy: (reason: RouteReason) => Pick<Route, 'via' | 'reason'>,
): Pick<Route, 'via' | 'reason'> {
  const f = rule.fallback;
  if (f === 'policy') return policy('rule');
  if (f !== 'offline') return go(f.to, 'fallback') ?? policy('fallback');
  // "Stay offline" means never another way: a rule through one listed proxy
  // always goes through it (and keeps retrying there).
  const to = rule.to as { proxy: string } | { group: string };
  if ('proxy' in to && p.list.some((e) => e.id === to.proxy)) return { via: { proxy: to.proxy }, reason: 'rule' };
  return { via: 'off', reason: 'proxy_down' };
}

/** What the offline policy means for one key: whether it connects straight while nothing it may use is reachable. */
export const connectsWhileOffline = (key: Pick<KeyInfo, 'operators_only'>, policy: OfflinePolicy) =>
  !(policy === 'kill_switch' || (policy === 'admin_only' && !key.operators_only) || (policy === 'invoicing_only' && key.operators_only));

/**
 * What `resolve` needs to preview `key`'s routes as the service would decide
 * them now: the proxy each destination uses (as health reports it, else the
 * first listed proxy not known to be down), and the offline policy.
 */
export function liveNow(pool: ProxyPool | null, p: ProxySettings, key: KeyInfo): { now: (d: Destination) => string | null; offline: boolean | null } {
  const lane = pool?.lanes.find((l) => l.key === key.id);
  const up = (id: string) => p.list.some((e) => e.id === id) && pool?.proxies.find((x) => x.id === id)?.reachable !== false;
  const now = (d: Destination): string | null => {
    if (lane !== undefined && sameDestination(d, lane.default)) return lane.active;
    if (typeof d === 'object' && 'group' in d) {
      const reported = lane?.groups.find((g) => g.group === d.group);
      if (reported !== undefined) return reported.active;
      return p.groups.find((g) => g.id === d.group)?.proxies.find(up) ?? null;
    }
    const id = (d as { proxy: string }).proxy;
    return up(id) ? id : null;
  };
  return { now, offline: lane === undefined ? null : connectsWhileOffline(key, pool!.offline) };
}

/** Whether some relay of `key` takes the default route (no rule matches it). */
export function usesDefault(s: Pick<NetworkSettings, 'relays' | 'relay_keys' | 'proxies'>, key: string, ids: string[]): boolean {
  return relaysFor(s, key, ids).some((relay) => firstRule(s.proxies.rules, key, relay) < 0);
}

/** Why a destination cannot be used, or an empty string. `who` starts the sentence ("Rule 2"). */
function destinationProblem(p: Pick<ProxySettings, 'list' | 'groups'>, d: Destination, who: string): string {
  if (typeof d !== 'object') return '';
  if ('proxy' in d) return p.list.some((e) => e.id === d.proxy) ? '' : `${who} goes through a proxy that is no longer listed. Change it first.`;
  return p.groups.some((g) => g.id === d.group) ? '' : `${who} goes through a group that no longer exists. Change it first.`;
}

/** Why the rule list and default route cannot be saved, or an empty string (the service's checks, and this page's own way in). */
export function rulesProblem(s: Pick<NetworkSettings, 'relays' | 'relay_keys' | 'proxies'>, keys: { id: string; label: string }[], dashboardRelays: string[]): string {
  const p = s.proxies;
  const rules = p.rules;
  const ids = keys.map((k) => k.id);
  if (rules.length > MAX_RULES) return `At most ${MAX_RULES} routing rules.`;
  for (const [i, r] of rules.entries()) {
    const n = i + 1;
    if (r.match.length === 0 || r.match.length > MAX_PATTERNS) return `Rule ${n}: between 1 and ${MAX_PATTERNS} relays or patterns are required.`;
    const bad = r.match.map(patternProblem).find((x) => x !== '');
    if (bad !== undefined) return `Rule ${n}: ${bad}`;
    const wrong = destinationProblem(p, r.to, `Rule ${n}`) || (typeof r.fallback === 'object' ? destinationProblem(p, r.fallback.to, `The fallback of rule ${n}`) : '');
    if (wrong !== '') return wrong;
    // (A fallback is only ever taken from a proxy or a group.)
    const viaProxy = typeof r.to === 'object';
    const direct = r.to === 'direct' || (viaProxy && typeof r.fallback === 'object' && r.fallback.to === 'direct');
    if (direct && !p.transparent && r.match.some(namesTorOrI2p)) return `Rule ${n}: Tor and I2P relays can only be reached through a proxy, never directly.`;
  }
  const wrong = destinationProblem(p, p.default, 'The default route') || keys.map((k) => (k.id in p.default_keys ? destinationProblem(p, p.default_keys[k.id], `The default route of ${k.label}`) : '')).find((x) => x !== '');
  if (wrong) return wrong;
  const open = (key: string, relay: string) => {
    const i = firstRule(rules, key, relay);
    return (i < 0 ? defaultFor(p, key) : rules[i].to) !== 'block';
  };
  for (const k of keys) {
    const relays = relaysFor(s, k.id, ids);
    if (relays.length > 0 && !relays.some((relay) => open(k.id, relay))) return `The rules and the default route block every relay of ${k.label}: it could not be reached.`;
  }
  const admin = keys.find((k) => k.id === 'admin');
  if (admin !== undefined && dashboardRelays.length > 0) {
    const mine = relaysFor(s, admin.id, ids).filter((r) => dashboardRelays.some((d) => bare(d) === bare(r)));
    if (mine.length > 0 && !mine.some((relay) => open(admin.id, relay))) return `The rules block every relay this page signs in through for ${admin.label}: you would be locked out.`;
  }
  return '';
}

/** A group's label, or its id when it has none. */
export const groupName = (g: { id: string; name: string }) => (g.name === '' ? g.id : g.name);

/** A destination in words. */
export function destination(to: Destination, p: Pick<ProxySettings, 'list' | 'groups'>): string {
  if (to === 'direct') return 'Direct, no proxy';
  if (to === 'block') return 'Nowhere: blocked';
  if ('proxy' in to) {
    const e = p.list.find((x) => x.id === to.proxy);
    return e === undefined ? 'A proxy that is no longer listed' : proxyName(e);
  }
  const g = p.groups.find((x) => x.id === to.group);
  return g === undefined ? 'A group that no longer exists' : `Group ${groupName(g)}`;
}

/** Every destination there is to pick, in order: the proxies, the groups, direct, block. */
export const destinations = (p: Pick<ProxySettings, 'list' | 'groups'>): Destination[] => [...p.list.map((e) => ({ proxy: e.id })), ...p.groups.map((g) => ({ group: g.id })), 'direct', 'block'];

/** A rule's fallback in words, as what happens "if it is down". */
export function fallbackText(f: Fallback, p: Pick<ProxySettings, 'list' | 'groups'>): string {
  if (f === 'offline') return 'If down: stay offline, never connect another way';
  if (f === 'policy') return 'If down: the offline policy decides';
  return `If down: ${destination(f.to, p)}, then the offline policy`;
}

/** The offline policies, and whether each connects straight. */
export const POLICIES: { value: OfflinePolicy; title: string; text: string; clearnet: boolean }[] = [
  { value: 'kill_switch', title: 'Kill switch', text: 'Disconnect those relays. They stay off until a proxy is back.', clearnet: false },
  { value: 'admin_only', title: 'Operators only', text: 'Connect straight, but answer operators only, so the proxies can be repaired (unless they are locked on the host).', clearnet: true },
  { value: 'invoicing_only', title: 'Invoicing only', text: 'Connect straight and keep invoicing on. Operators are not served, so nothing can be managed.', clearnet: true },
  { value: 'open', title: 'Carry on', text: 'Connect straight and serve everyone as usual.', clearnet: true },
];

/**
 * How a route through `to` can end in a direct connection, in words, or an
 * empty string. `fallback` is the rule's; the default route follows the
 * offline policy (`'policy'`).
 */
export function directEnd(to: Destination, fallback: Fallback, offline: OfflinePolicy, p: Pick<ProxySettings, 'list' | 'groups'>): string {
  if (to === 'direct') return 'These relays connect straight: they see this machine’s IP address.';
  if (to === 'block') return '';
  const policy = POLICIES.find((x) => x.value === offline)!;
  if (typeof fallback === 'object' && fallback.to === 'direct') return `While ${destination(to, p)} has nothing reachable, these relays connect straight: they see this machine’s IP address.`;
  // A fallback that blocks never leaves anything to the policy.
  if (fallback === 'offline' || (typeof fallback === 'object' && fallback.to === 'block') || !policy.clearnet) return '';
  const first = fallback === 'policy' ? destination(to, p) : `${destination(to, p)} and ${destination(fallback.to, p)}`;
  return `While ${first} ${fallback === 'policy' ? 'has' : 'both have'} nothing reachable, the offline policy (${policy.title}) connects these relays straight for the keys it serves: they see this machine’s IP address.`;
}

/** What points at a proxy or a group, in words ("rule 2", "the fallback of rule 3", "group Exits", "the default route"). */
export function usedBy(p: ProxySettings, target: { proxy: string } | { group: string }, keys: { id: string; label: string }[]): string[] {
  const is = (d: Destination) => sameDestination(d, target);
  const out: string[] = [];
  if ('proxy' in target) for (const g of p.groups) if (g.proxies.includes(target.proxy)) out.push(`group ${groupName(g)}`);
  p.rules.forEach((r, i) => {
    if (is(r.to)) out.push(`rule ${i + 1}`);
    if (typeof r.fallback === 'object' && is(r.fallback.to)) out.push(`the fallback of rule ${i + 1}`);
  });
  if (is(p.default)) out.push('the default route');
  for (const [k, d] of Object.entries(p.default_keys)) if (is(d)) out.push(`the default route of ${keys.find((x) => x.id === k)?.label ?? k}`);
  return out;
}

/**
 * The keys (ids) that may send relays through a proxy or a group: a rule for
 * the key, its fallback, or the key's default route points at it (or, for a
 * proxy, at a group it is in).
 */
export function keysUsing(p: ProxySettings, target: { proxy: string } | { group: string }, keys: { id: string }[]): string[] {
  const inGroup = (d: Destination) => 'proxy' in target && typeof d === 'object' && 'group' in d && p.groups.some((g) => g.id === d.group && g.proxies.includes(target.proxy));
  const hits = (d: Destination) => sameDestination(d, target) || inGroup(d);
  return keys
    .filter((k) => {
      const rules = p.rules.filter((r) => r.keys.length === 0 || r.keys.includes(k.id));
      return hits(defaultFor(p, k.id)) || rules.some((r) => hits(r.to) || (typeof r.fallback === 'object' && hits(r.fallback.to)));
    })
    .map((k) => k.id);
}

/** A proxy's label, or its address when it has none. */
export const proxyName = (e: { name: string; url: string }) => (e.name === '' ? e.url : e.name);

/** Why a relay goes the way it does, in words. */
export const REASONS: Record<RouteReason, string> = {
  rule: 'by the rule',
  default: 'default route',
  fallback: 'fallback: the rule’s proxy or group is down',
  proxy_down: 'offline: the rule’s proxy or group has nothing reachable, and the rule stays offline',
  blocked: 'blocked by a rule or the default route',
  pool_offline: 'offline: nothing it may use is reachable, and the offline policy keeps it off',
  never_direct: 'offline: Tor and I2P relays are never reached directly',
  transparent: 'straight to the transparent proxy',
};

/** A new rule with nothing filled in, going through the first group or proxy there is. */
export function newRule(p: Pick<ProxySettings, 'list' | 'groups'>): Rule {
  const to: Destination = p.groups.length > 0 ? { group: p.groups[0].id } : p.list.length > 0 ? { proxy: p.list[0].id } : 'direct';
  return { name: '', match: [], keys: [], to, fallback: 'offline' };
}
