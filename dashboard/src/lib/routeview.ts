// What the Network views show, worked out from the service's live routes
// (health) and the saved settings: rows for the map, the tiles above it, a
// summary per proxy, and the trace of a relay through the rules.
import { firstRule, hostPort, isLocalOrOverlay, proxyName } from './routes';
import type { KeyInfo, ProxyPool, RouteReason, RouteState, Rule, Settings } from './schemas';

/** One line of the map: a relay, for some keys, and where it goes. */
export interface MapRow {
  relay: string;
  /** The keys this row is for (all of the relay's keys when they agree). */
  keys: string[];
  rule: number | null;
  via: RouteState['via'];
  proxy: string | null;
  reason: RouteReason;
}

const same = (a: RouteState, b: RouteState) => a.rule === b.rule && a.via === b.via && a.proxy === b.proxy && a.reason === b.reason;

/** The map's rows: one per relay when its keys agree, else one per key. `key` limits it to one key. */
export function mapRows(routes: RouteState[], key: string | null): MapRow[] {
  const rows: MapRow[] = [];
  const relays = [...new Set(routes.map((r) => r.relay))];
  for (const relay of relays) {
    const mine = routes.filter((r) => r.relay === relay && (key === null || r.key === key));
    if (mine.length === 0) continue;
    const row = (r: RouteState, keys: string[]): MapRow => ({ relay, keys, rule: r.rule, via: r.via, proxy: r.proxy, reason: r.reason });
    if (mine.every((r) => same(r, mine[0]))) rows.push(row(mine[0], mine.map((r) => r.key)));
    else rows.push(...mine.map((r) => row(r, [r.key])));
  }
  return rows;
}

/** What a relay reaches at the far end, in words. */
export function reaches(relay: string, via: RouteState['via']): { what: string; note: string } {
  const host = hostPort(relay)?.host ?? '';
  if (via === 'off') return { what: 'Nothing', note: 'not connected' };
  if (host.endsWith('.onion')) return { what: 'Tor hidden service', note: 'never leaves Tor' };
  if (host.endsWith('.i2p')) return { what: 'I2P site', note: 'never leaves I2P' };
  if (host.endsWith('.fips')) return { what: 'FIPS mesh', note: 'encrypted end to end' };
  if (isLocalOrOverlay(relay)) return { what: 'This network', note: 'not the internet' };
  return via === 'proxy' ? { what: 'Internet', note: 'through the proxy' } : { what: 'Internet', note: "sees this machine's IP" };
}

/** The rule's patterns, for a row. */
export const ruleText = (rules: Rule[], rule: number | null) => (rule === null ? 'default route' : (rules[rule - 1]?.match.join(', ') ?? `rule ${rule}`));

export interface Tile {
  label: string;
  value: string;
  line: string;
  tone: 'ok' | 'warn' | 'bad' | 'none';
}

/** The four numbers above the map. */
export function tiles(routes: RouteState[], live: Settings, pool: ProxyPool): Tile[] {
  const relays = [...new Set(routes.map((r) => r.relay))];
  const dark = relays.filter((relay) => routes.filter((r) => r.relay === relay).every((r) => r.via === 'off'));
  const rules = live.proxies.rules;
  const unused = rules.filter((_, i) => !routes.some((r) => r.rule === i + 1)).length;
  const down = pool.proxies.filter((p) => p.reachable === false).length;
  const direct = [...new Set(routes.filter((r) => r.via === 'direct').map((r) => r.relay))];
  const exposed = direct.filter((r) => !isLocalOrOverlay(r)).length;
  return [
    { label: 'Relays', value: String(relays.length), line: dark.length === 0 ? 'Every relay has a route' : `${dark.length} with no route now`, tone: dark.length === 0 ? 'ok' : 'bad' },
    { label: 'Rules', value: String(rules.length), line: unused === 0 ? (rules.length === 0 ? 'Every relay takes the default route' : 'Every rule is in use') : `${unused} match no relay yet`, tone: 'none' },
    { label: 'Proxies', value: String(pool.proxies.length), line: down === 0 ? 'None is down' : `${down} down`, tone: down === 0 ? 'ok' : 'warn' },
    { label: 'Direct', value: String(direct.length), line: exposed === 0 ? 'None to the open internet' : `${exposed} to the internet: they see this machine's IP`, tone: exposed === 0 ? 'none' : 'warn' },
  ];
}

/** One proxy, from the relays' side. */
export interface ProxySummary {
  id: string;
  name: string;
  url: string;
  reachable: boolean | null;
  /** Relays it carries now, and which of them only because their own proxy is down. */
  carries: string[];
  fallback: string[];
  /** Numbers (from 1) of the rules that point at it. */
  rules: number[];
  /** Position in the default route (from 1), or null when it is kept for rules only. */
  position: number | null;
}

export function proxySummaries(routes: RouteState[], live: Settings, pool: ProxyPool): ProxySummary[] {
  const inPool = live.proxies.list.filter((e) => e.pool);
  return live.proxies.list.map((e) => {
    const health = pool.proxies.find((p) => p.id === e.id);
    const through = routes.filter((r) => r.proxy === e.id);
    return {
      id: e.id,
      name: proxyName(e),
      url: health?.url ?? e.url,
      reachable: health?.reachable ?? null,
      carries: [...new Set(through.map((r) => r.relay))],
      fallback: [...new Set(through.filter((r) => r.reason === 'fallback').map((r) => r.relay))],
      rules: live.proxies.rules.flatMap((r, i) => (typeof r.to === 'object' && r.to.proxy === e.id ? [i + 1] : [])),
      position: e.pool ? inPool.indexOf(e) + 1 : null,
    };
  });
}

/** How one rule was checked against a relay, for one key. */
export interface Check {
  no: number;
  match: string;
  /** Whether the rule applies to the key at all. */
  forKey: boolean;
  matched: boolean;
}

/** The rules in order against one relay and key, up to the first that matches. */
export function trace(rules: Rule[], key: string, relay: string): Check[] {
  const hit = firstRule(rules, key, relay);
  const upto = hit < 0 ? rules : rules.slice(0, hit + 1);
  return upto.map((r, i) => ({ no: i + 1, match: r.match.join(', '), forKey: r.keys.length === 0 || r.keys.includes(key), matched: i === hit }));
}

/** A key's label, or its id when the service did not name it. */
export const keyLabel = (keys: KeyInfo[], id: string) => keys.find((k) => k.id === id)?.label ?? id;
