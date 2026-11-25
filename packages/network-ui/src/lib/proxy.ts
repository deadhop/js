// Proxies as form fields and back. The service stores each URL and shows its
// password as `***`; the password stays with the proxy's id unless re-entered.
import type { ProxiesPatch, ProxyInput } from './network-api';
import { groupName } from './routes';
import type { ProxyEntry, ProxyGroup, ProxySettings, Rule, Strategy } from './schemas';
/** `i2p` is an I2P router's HTTP proxy: stored as `http://` with `i2p: true`. */
export type ProxyKind = 'none' | 'socks5' | 'https' | 'http' | 'i2p';

export interface ProxyFields {
  kind: ProxyKind;
  host: string;
  port: string;
  username: string;
  password: string;
  /** The service already holds a password for this proxy. */
  hasPassword: boolean;
}

export const NO_PROXY: ProxyFields = { kind: 'none', host: '', port: '', username: '', password: '', hasPassword: false };

const SCHEMES: Record<string, ProxyKind> = { 'socks5:': 'socks5', 'socks5h:': 'socks5', 'https:': 'https', 'http:': 'http' };
const DEFAULT_PORT: Record<string, string> = { 'https:': '443', 'http:': '80' };

/** An I2P router's HTTP proxy port, unless set up otherwise. */
export const I2P_PORT = '4444';

/** The form fields for a proxy's URL; `i2p` marks an I2P router's HTTP proxy. */
export function parseProxy(url: string, i2p = false): ProxyFields {
  if (url === '') return { ...NO_PROXY };
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ...NO_PROXY };
  }
  const kind = SCHEMES[u.protocol] ?? 'none';
  return {
    kind: i2p && kind === 'http' ? 'i2p' : kind,
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port || (DEFAULT_PORT[u.protocol] ?? ''),
    username: decodeURIComponent(u.username),
    password: '',
    hasPassword: u.password !== '',
  };
}

/** The URL for these fields, or an error message. */
export function buildProxy(f: ProxyFields): { url: string } | { error: string } {
  if (f.kind === 'none') return { url: '' };
  const host = f.host.trim();
  if (!/^[A-Za-z0-9.\-:]+$/.test(host)) return { error: 'Enter the proxy host (name or IP address).' };
  const port = Number(f.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: 'Enter a proxy port between 1 and 65535.' };
  if (f.hasPassword && f.password === '' && f.username !== '') return { error: 'Re-enter the proxy password to change the proxy.' };
  const shownHost = host.includes(':') ? `[${host}]` : host;
  const user = f.username === '' ? '' : encodeURIComponent(f.username);
  const pass = f.password === '' ? '' : `:${encodeURIComponent(f.password)}`;
  const auth = user === '' ? '' : `${user}${pass}@`;
  return { url: `${f.kind === 'i2p' ? 'http' : f.kind}://${auth}${shownHost}:${port}` };
}

/** Most proxies in the list. */
export const MAX_PROXIES = 8;
/** Shortest and longest interval the service accepts, in seconds. */
export const MIN_SECS = 60;
export const MAX_SECS = 604_800;
/** Most groups, and fewest proxies in one. */
export const MAX_GROUPS = 8;
export const GROUP_MIN = 2;

/** Whether a proxy or group is not saved yet: the saved list has no entry with its id. */
export const isNew = (e: { id: string }, saved: { id: string }[]) => !saved.some((x) => x.id === e.id);

/** A fresh id that `taken` does not hold: `prefix` and eight hex digits, as the service makes them. */
export function freshId(prefix: string, taken: string[]): string {
  for (;;) {
    const b = crypto.getRandomValues(new Uint8Array(4));
    const id = prefix + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    if (!taken.includes(id)) return id;
  }
}

/** A proxy that is not saved yet. Its id is chosen here, so rules, groups and the default route can name it before it is saved. */
export function newEntry(name: string, url: string, i2p: boolean, taken: string[]): ProxyEntry {
  return { id: freshId('p', taken), name, url, i2p };
}

/** A group id made from its name: lower case, digits, `-`; another when taken. Chosen once, kept on renames. */
export function groupId(name: string, taken: string[]): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20)
    .replace(/-+$/, '');
  if (slug === '') return freshId('g', taken);
  let id = slug;
  for (let n = 2; taken.includes(id); n += 1) id = `${slug}-${n}`;
  return id;
}

/** A new group of `proxies` (ids, in order), failover until changed. */
export function newGroup(name: string, proxies: string[], taken: string[]): ProxyGroup {
  return { id: groupId(name, taken), name, proxies, strategy: 'failover', rotate_secs: 3600, chaos_min_secs: 300, chaos_max_secs: 900 };
}

/** The strategies, in words. */
export const STRATEGIES: { value: Strategy; title: string; text: string }[] = [
  { value: 'failover', title: 'Failover', text: 'Use the first proxy in the group. If it is down, use the next one; go back to an earlier one once it has stayed up for 2 minutes.' },
  { value: 'round_robin', title: 'Round-robin', text: 'Go around the group, one change at a set interval (not per connection).' },
  { value: 'chaos', title: 'Chaos', text: 'Switch to a random other proxy in the group after a random time between a shortest and a longest interval.' },
];

/** The I2P router proxy, if one is listed. */
export const i2pProxy = (p: ProxySettings) => p.list.find((e) => e.i2p === true);

/** The rule that sends `.i2p` relays through one proxy. */
export const i2pRule = (id: string): Rule => ({ name: '', match: ['*.i2p'], keys: [], to: { proxy: id }, fallback: 'offline' });

/** The position of the first rule that names `*.i2p`, or -1. */
export const i2pRuleIndex = (rules: Rule[]) => rules.findIndex((r) => r.match.includes('*.i2p'));

/** Most I2P name registries, and the longest address of one. */
export const MAX_REGISTRIES = 4;
const REGISTRY_LEN = 200;

/** Why an I2P name registry address cannot be added, or an empty string. The same rules as the service. */
export function registryProblem(t: string, listed: string[]): string {
  if (t.length > REGISTRY_LEN || /\s/.test(t)) return `A registry address has no spaces and at most ${REGISTRY_LEN} characters.`;
  const m = /^http:\/\/([^/?]*)(.*)$/.exec(t);
  if (m === null) return 'A registry address starts with http://.';
  if (!/^[a-z0-9.-]+\.i2p$/.test(m[1])) return 'A registry address names a lowercase .i2p host, with no port or user name.';
  if (!m[2].includes('{name}')) return 'Put {name} after the host, where the name goes.';
  if (listed.includes(t)) return 'That registry is already listed.';
  return '';
}

/** `list` with the item at `from` moved to position `to`. */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list;
  const out = [...list];
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}

/**
 * The URL after editing a saved proxy. With the password hidden and nothing
 * else about the address changed, the hidden form is kept (the service restores
 * the password from the id); anything else needs the password again.
 */
export function editedUrl(old: string, f: ProxyFields): { url: string } | { error: string } {
  const before = parseProxy(old);
  const same = (['host', 'port', 'username'] as const).every((k) => f[k] === before[k]) && (f.kind === 'i2p' ? 'http' : f.kind) === before.kind;
  if (same && f.password === '' && before.hasPassword) return { url: old };
  return buildProxy(f);
}

export type Unit = 's' | 'm' | 'h' | 'd';
const UNIT_SECS: Record<Unit, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

/** A number of seconds as the largest unit that divides it evenly. */
export function splitDuration(secs: number): { n: number; unit: Unit } {
  const unit = (['d', 'h', 'm'] as const).find((u) => secs > 0 && secs % UNIT_SECS[u] === 0) ?? 's';
  return { n: secs / UNIT_SECS[unit], unit };
}

export const toSecs = (n: number, unit: Unit) => n * UNIT_SECS[unit];

/** Seconds as short text: `15m`, `1h 30m`. */
export function shortDuration(secs: number): string {
  const { n, unit } = splitDuration(secs);
  if (unit !== 's' || secs < 60) return `${n}${unit}`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

const entryKey = (e: ProxyEntry) => `${e.id}\n${e.name}\n${e.url}\n${e.i2p === true}`;

/** A proxy as sent, with its id; `i2p` only when it is an I2P router. */
function input(e: ProxyEntry): ProxyInput {
  const out: ProxyInput = { id: e.id, name: e.name, url: e.url };
  if (e.i2p === true) out.i2p = true;
  return out;
}

/** Why the groups cannot be saved, or an empty string. The same checks as the service. */
export function groupsProblem(p: Pick<ProxySettings, 'list' | 'groups'>): string {
  if (p.groups.length > MAX_GROUPS) return `At most ${MAX_GROUPS} groups.`;
  for (const g of p.groups) {
    const who = `Group ${groupName(g)}`;
    if (g.proxies.length < GROUP_MIN) return `${who} needs at least ${GROUP_MIN} proxies. To use a single proxy, point the rule or the default route at it.`;
    if (g.proxies.some((id) => !p.list.some((e) => e.id === id))) return `${who} holds a proxy that is no longer listed. Take it out of the group first.`;
    for (const k of ['rotate_secs', 'chaos_min_secs', 'chaos_max_secs'] as const) {
      const v = g[k];
      if (!Number.isInteger(v)) return `${who}: fill in every interval.`;
      if (v < MIN_SECS || v > MAX_SECS) return `${who}: intervals run from 1 minute to 7 days.`;
    }
    if (g.chaos_min_secs > g.chaos_max_secs) return `${who}: the shortest chaos interval is longer than the longest.`;
  }
  return '';
}

/** A record as text that does not depend on the order of its keys. */
const recordText = (m: Record<string, unknown>) => JSON.stringify(Object.entries(m).sort(([a], [b]) => a.localeCompare(b)));

/** What differs from the live proxy settings, or the problem with the form. */
export function proxiesPatch(live: ProxySettings, form: ProxySettings): ProxiesPatch | string {
  const problem = groupsProblem(form);
  if (problem !== '') return problem;
  const patch: ProxiesPatch = {};
  if (form.list.map(entryKey).join('\u0000') !== live.list.map(entryKey).join('\u0000')) patch.list = form.list.map(input);
  if (JSON.stringify(form.groups) !== JSON.stringify(live.groups)) patch.groups = form.groups;
  if (JSON.stringify(form.default) !== JSON.stringify(live.default)) patch.default = form.default;
  if (recordText(form.default_keys) !== recordText(live.default_keys)) patch.default_keys = { ...form.default_keys };
  if (JSON.stringify(form.i2p_registries) !== JSON.stringify(live.i2p_registries)) patch.i2p_registries = [...form.i2p_registries];
  if (JSON.stringify(form.rules) !== JSON.stringify(live.rules)) patch.rules = form.rules;
  if (form.offline !== live.offline) patch.offline = form.offline;
  if (form.transparent !== live.transparent) patch.transparent = form.transparent;
  return patch;
}
