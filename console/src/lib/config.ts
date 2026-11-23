// Which service the console manages: its administration key and the relays it
// listens on, as the operator typed them. Remembered in this browser (both are
// public); a secret key never is.
import { nip19 } from 'nostr-tools';
import { normalizePubkey, type ServiceConfig } from '@deadhop/client';

const STORE = 'deadhop-console:target';
const RELAY = /^wss?:\/\/[^\s]+$/;
export const MAX_RELAYS = 8;

/** What the sign-in form holds. */
export interface TargetInput {
  pubkey: string;
  relays: string;
}

/** Relays carried by an nprofile, or none. */
export function profileRelays(value: string): string[] {
  try {
    const d = nip19.decode(value.trim().replace(/^nostr:/, ''));
    return d.type === 'nprofile' ? (d.data.relays ?? []) : [];
  } catch {
    return [];
  }
}

/** The relays in a box: one per line, or separated by spaces or commas. */
export const splitRelays = (text: string): string[] => [...new Set(text.split(/[\s,]+/).filter((r) => r !== ''))];

/** Where to connect, or why the input cannot be used. An nprofile's relays stand in for an empty list. */
export function parseTarget(input: TargetInput): ServiceConfig | string {
  const serverPubkey = normalizePubkey(input.pubkey);
  if (serverPubkey === null) return "Enter the service's administration key: hex, npub or nprofile (what `deadhop pubkey admin` prints).";
  const typed = splitRelays(input.relays);
  const relays = typed.length > 0 ? typed : profileRelays(input.pubkey);
  if (relays.length === 0) return 'Enter at least one relay the administration key listens on.';
  if (relays.length > MAX_RELAYS) return `At most ${MAX_RELAYS} relays.`;
  const bad = relays.find((r) => !RELAY.test(r));
  if (bad !== undefined) return `${bad} is not a relay address: it starts with ws:// or wss://.`;
  return { serverPubkey, relays };
}

/** The target used last in this browser, if any. */
export function loadTarget(storage: Storage = localStorage): TargetInput {
  try {
    const v: unknown = JSON.parse(storage.getItem(STORE) ?? 'null');
    if (v !== null && typeof v === 'object') {
      const { pubkey, relays } = v as Record<string, unknown>;
      if (typeof pubkey === 'string' && typeof relays === 'string') return { pubkey, relays };
    }
  } catch {
    // Unreadable: start empty.
  }
  return { pubkey: '', relays: '' };
}

export function saveTarget(t: TargetInput, storage: Storage = localStorage): void {
  storage.setItem(STORE, JSON.stringify({ pubkey: t.pubkey.trim(), relays: t.relays.trim() }));
}
