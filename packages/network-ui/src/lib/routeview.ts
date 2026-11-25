// What the Network views show, worked out from the service's live routes
// (health) and the saved settings: rows for the map, the tiles above it, a
// summary per proxy, and the trace of a relay through the rules.
import { formatDuration } from './format';
import { REASONS, defaultFor, destination, firstRule, groupName, hostPort, isLocalOrOverlay, proxyName, sameDestination } from './routes';
import type { Destination, GroupHealth, KeyInfo, NetworkSettings, ProxyPool, ProxySettings, RouteReason, RouteState, Rule } from './schemas';

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
export function tiles(routes: RouteState[], live: NetworkSettings, pool: ProxyPool): Tile[] {
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
  /** The groups it is in, by name. */
  groups: string[];
  /** Whether a key's default route is this proxy, or a group it is in. */
  inDefault: boolean;
}

export function proxySummaries(routes: RouteState[], live: NetworkSettings, pool: ProxyPool): ProxySummary[] {
  const p = live.proxies;
  const defaults = [p.default, ...Object.values(p.default_keys)];
  return p.list.map((e) => {
    const groups = p.groups.filter((g) => g.proxies.includes(e.id));
    const health = pool.proxies.find((p) => p.id === e.id);
    const through = routes.filter((r) => r.proxy === e.id);
    return {
      id: e.id,
      name: proxyName(e),
      url: health?.url ?? e.url,
      reachable: health?.reachable ?? null,
      carries: [...new Set(through.map((r) => r.relay))],
      fallback: [...new Set(through.filter((r) => r.reason === 'fallback').map((r) => r.relay))],
      rules: p.rules.flatMap((r, i) => (sameDestination(r.to, { proxy: e.id }) ? [i + 1] : [])),
      groups: groups.map(groupName),
      inDefault: defaults.some((d) => sameDestination(d, { proxy: e.id }) || groups.some((g) => sameDestination(d, { group: g.id }))),
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

/** A group's state for one key, in words: what it uses now and when it switches. */
export function groupStateText(g: GroupHealth, pool: Pick<ProxyPool, 'proxies'>, now = Math.floor(Date.now() / 1000)): string {
  const proxy = pool.proxies.find((x) => x.id === g.active);
  const using = proxy === undefined ? '' : `using ${proxyName(proxy)}`;
  const next = g.next_switch_at === null ? '' : ` · next switch in ${formatDuration(Math.max(0, g.next_switch_at - now))}`;
  switch (g.state) {
    case 'active':
      return `${using}${next}`;
    case 'suspended':
      return `${using} · rotation suspended: only ${g.reachable} proxy is reachable`;
    case 'offline':
      return 'offline: no proxy in the group is reachable';
    default:
      return g.state;
  }
}

/** One group as the service runs it: per key, or once when every key agrees. */
export interface GroupSummary {
  id: string;
  name: string;
  members: string[];
  strategy: string;
  /** What it does now: one line per key, or one with key '' when the keys agree. */
  lines: { key: string; text: string; tone: 'ok' | 'warn' | 'bad' }[];
  /** Whether a default route uses it. */
  inDefault: boolean;
}

const STRATEGY_TITLES: Record<string, string> = { failover: 'Failover', round_robin: 'Round-robin', chaos: 'Chaos' };

export function groupSummaries(live: Pick<ProxySettings, 'list' | 'groups' | 'default' | 'default_keys'>, pool: ProxyPool | null, keys: KeyInfo[], now?: number): GroupSummary[] {
  return live.groups.map((g) => {
    const per = (pool?.lanes ?? []).flatMap((l) => {
      const h = l.groups.find((x) => x.group === g.id);
      return h === undefined ? [] : [{ key: l.key, text: groupStateText(h, pool!, now), tone: h.state === 'active' ? ('ok' as const) : h.state === 'suspended' ? ('warn' as const) : ('bad' as const) }];
    });
    const lines = per.length > 1 && per.every((x) => x.text === per[0].text) ? [{ ...per[0], key: '' }] : per;
    return {
      id: g.id,
      name: groupName(g),
      members: g.proxies.map((id) => destination({ proxy: id }, live)),
      strategy: STRATEGY_TITLES[g.strategy],
      lines,
      inDefault: keys.some((k) => sameDestination(defaultFor(live, k.id), { group: g.id })),
    };
  });
}

/**
 * Why a relay of `key` goes the way it does, in words. Health does not mark
 * a direct connection the offline policy made: it shows as the reason of the
 * route that had nothing reachable, so one that should have gone through a
 * proxy or a group is said to be the policy's.
 */
export function why(r: Pick<RouteState, 'rule' | 'via' | 'reason'>, key: string, p: Pick<ProxySettings, 'rules' | 'default' | 'default_keys'>): string {
  const rule = r.rule === null ? undefined : p.rules[r.rule - 1];
  let meant: Destination | undefined;
  if (r.reason === 'default') meant = defaultFor(p, key);
  else if (r.reason === 'rule') meant = rule?.to;
  else if (r.reason === 'fallback' && typeof rule?.fallback === 'object') meant = rule.fallback.to;
  return r.via === 'direct' && typeof meant === 'object' ? 'straight, by the offline policy: nothing it may use is reachable' : REASONS[r.reason];
}

/** What the default route's group does now (the public invoices key's, as the fields of `pool` are), or null when the default route is not a group. */
export function defaultGroup(pool: ProxyPool): GroupHealth | null {
  const d = pool.default;
  if (typeof d !== 'object' || !('group' in d)) return null;
  const reported = pool.lanes.flatMap((l) => (sameDestination(l.default, d) ? l.groups : [])).find((g) => g.group === d.group);
  return reported ?? { group: d.group, state: pool.state, active: pool.active, reachable: pool.reachable, next_switch_at: null };
}
