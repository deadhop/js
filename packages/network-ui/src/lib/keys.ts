// The service's keys and which relays each one uses. A relay lists the keys
// that may use it; an empty list is every key.
import { getContext, setContext } from 'svelte';
import type { KeyInfo, NetworkSettings } from './schemas';

export const ADMIN = 'admin';
const bare = (url: string) => url.replace(/\/$/, '');

/** The keys (ids) that use something assigned to `assigned`; empty is all of `ids`. */
export const usersOf = (assigned: string[] | undefined, ids: string[]): string[] => (assigned === undefined || assigned.length === 0 ? ids : assigned);

/** Which keys use a relay, by the address it is listed under (a trailing slash does not matter). */
export function relayUsers(relayKeys: NetworkSettings['relay_keys'], url: string, ids: string[]): string[] {
  const found = Object.entries(relayKeys).find(([u]) => bare(u) === bare(url));
  return usersOf(found?.[1], ids);
}

/** `assigned` with `id` switched on or off, in key order; everything on is stored as empty ("all keys"). */
export function toggled(assigned: string[], id: string, on: boolean, ids: string[]): string[] {
  const now = usersOf(assigned, ids);
  const next = ids.filter((k) => (k === id ? on : now.includes(k)));
  return next.length === ids.length ? [] : next;
}

/** The relay map as saved: only relays with a restriction, only relays that are listed. */
export function relayKeysFor(relays: string[], relayKeys: NetworkSettings['relay_keys'], ids: string[]): NetworkSettings['relay_keys'] {
  const out: NetworkSettings['relay_keys'] = {};
  for (const url of relays) {
    const users = relayUsers(relayKeys, url, ids);
    if (users.length < ids.length) out[url] = users;
  }
  return out;
}

/** A stable text of a relay map, to tell whether it changed. */
export const relayKeysText = (m: NetworkSettings['relay_keys']) =>
  JSON.stringify(
    Object.entries(m)
      .map(([u, k]) => [bare(u), [...k].sort()] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );

/** The relays one key connects to. */
export const relaysOf = (relays: string[], relayKeys: NetworkSettings['relay_keys'], id: string, ids: string[]) =>
  relays.filter((r) => relayUsers(relayKeys, r, ids).includes(id));

/** Why this assignment cannot be saved, or an empty string. */
export function assignmentProblem(keys: KeyInfo[], form: NetworkSettings): string {
  const ids = keys.map((k) => k.id);
  const bare = keys.find((k) => relaysOf(form.relays, form.relay_keys, k.id, ids).length === 0);
  return bare === undefined ? '' : `No relay is assigned to ${bare.label}: it could not be reached. Give it one.`;
}

/** Whether a key is the operators' (administration) key. */
export const isOperators = (k: Pick<KeyInfo, 'id' | 'operators_only'>) => k.operators_only || k.id === ADMIN;

/** The invoice keys: every key that is not the operators'. */
export const invoiceKeys = (keys: KeyInfo[]) => keys.filter((k) => !isOperators(k));

/** The keys for display: the operators' first, then the invoice keys in the service's order. */
export const displayOrder = (keys: KeyInfo[]) => [...keys.filter(isOperators), ...invoiceKeys(keys)];

/**
 * Key colours. Each invoice key has one of eight colours, the administration
 * key is always graphite. A page that stores the colours (the operators pick
 * them) provides them through this context as a map of key id to palette
 * index; without it, a key takes the colour of its place among the invoice keys.
 */
export const KEY_COLORS = 'deadhop:key-colors';
export const KEY_PALETTE = 8;

/** Provide stored key colours to the views below (during component init). A `$state` object stays live. */
export const setKeyColors = (colors: Record<string, number>) => setContext(KEY_COLORS, colors);

/** The stored key colours, if a page above provided them (during component init). */
export const keyColors = (): Record<string, number> => getContext<Record<string, number> | undefined>(KEY_COLORS) ?? {};

/** A key's palette index, or null for the administration key (graphite). */
export function keyColor(keys: KeyInfo[], id: string, colors: Record<string, number> = {}): number | null {
  const k = keys.find((x) => x.id === id);
  if (k === undefined ? id === ADMIN : isOperators(k)) return null;
  const stored = colors[id];
  if (stored !== undefined) return ((stored % KEY_PALETTE) + KEY_PALETTE) % KEY_PALETTE;
  const i = invoiceKeys(keys).findIndex((x) => x.id === id);
  return Math.max(i, 0) % KEY_PALETTE;
}

/** The class that sets `--kc` to a key's colour. */
export const keyColorClass = (keys: KeyInfo[], id: string, colors: Record<string, number> = {}) => {
  const c = keyColor(keys, id, colors);
  return c === null ? 'kc-admin' : `kc${c}`;
};

/** The keys in runs that share a value (in key order), so one line can say what several keys have in common. */
export function sameFor<T>(keys: KeyInfo[], value: (k: KeyInfo) => T, eq: (a: T, b: T) => boolean = (a, b) => a === b): { keys: KeyInfo[]; value: T }[] {
  const out: { keys: KeyInfo[]; value: T }[] = [];
  for (const k of keys) {
    const v = value(k);
    const found = out.find((g) => eq(g.value, v));
    if (found === undefined) out.push({ keys: [k], value: v });
    else found.keys.push(k);
  }
  return out;
}

/** Labels as a phrase: `A`, `A and B`, `A, B and C`. */
export const labelList = (labels: string[]) => (labels.length < 2 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`);

/**
 * The keys that depend on `url`: without it they would have no relay left, or
 * (the administration key) none that this page connects through. Such a key
 * cannot be switched off for that relay, and removing the relay first asks for
 * a replacement.
 */
export function dependents(relays: string[], relayKeys: NetworkSettings['relay_keys'], url: string, ids: string[], dashboard: string[]): string[] {
  const same = (a: string) => bare(a) === bare(url);
  const isDash = (r: string) => dashboard.some((d) => bare(d) === bare(r));
  return ids.filter((k) => {
    const mine = relaysOf(relays, relayKeys, k, ids);
    if (!mine.some(same)) return false;
    const rest = mine.filter((r) => !same(r));
    if (rest.length === 0) return true;
    return k === ADMIN && isDash(url) && !rest.some(isDash);
  });
}

/** Relays that could take over for `key` when `url` goes: the other listed ones, and this page's own if not listed. For the administration key, only relays this page connects through. */
export function replacements(relays: string[], url: string, key: string, dashboard: string[]): string[] {
  const isDash = (r: string) => dashboard.some((d) => bare(d) === bare(r));
  const others = relays.filter((r) => bare(r) !== bare(url));
  const extra = dashboard.filter((d) => bare(d) !== bare(url) && !relays.some((r) => bare(r) === bare(d)));
  const all = [...others, ...extra];
  return key === ADMIN && isDash(url) ? all.filter(isDash) : all;
}
