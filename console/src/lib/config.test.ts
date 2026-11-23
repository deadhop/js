import { describe, expect, it } from 'vitest';
import { nip19 } from 'nostr-tools';
import { MAX_RELAYS, loadTarget, parseTarget, profileRelays, saveTarget, splitRelays } from './config';
import { ADMIN_PUBKEY } from '../test-helpers';

const RELAY = 'ws://127.0.0.1:7777';
const npub = nip19.npubEncode(ADMIN_PUBKEY);
const nprofile = nip19.nprofileEncode({ pubkey: ADMIN_PUBKEY, relays: ['wss://relay.example.com'] });

describe('parseTarget', () => {
  it('takes the administration key as hex, npub or nprofile', () => {
    for (const pubkey of [ADMIN_PUBKEY, npub, `nostr:${npub}`, nprofile]) {
      expect(parseTarget({ pubkey, relays: RELAY })).toEqual({ serverPubkey: ADMIN_PUBKEY, relays: [RELAY] });
    }
  });

  it('uses the relays of an nprofile when none are typed', () => {
    expect(parseTarget({ pubkey: nprofile, relays: ' ' })).toEqual({ serverPubkey: ADMIN_PUBKEY, relays: ['wss://relay.example.com'] });
  });

  it('splits relays on lines, spaces and commas, each once', () => {
    expect(splitRelays(`${RELAY}\nwss://a.example, wss://b.example ${RELAY}`)).toEqual([RELAY, 'wss://a.example', 'wss://b.example']);
  });

  it('says what is wrong', () => {
    expect(parseTarget({ pubkey: 'nsec1nope', relays: RELAY })).toContain('administration key');
    expect(parseTarget({ pubkey: npub, relays: '' })).toBe('Enter at least one relay the administration key listens on.');
    expect(parseTarget({ pubkey: npub, relays: 'https://relay.example.com' })).toBe('https://relay.example.com is not a relay address: it starts with ws:// or wss://.');
    const many = Array.from({ length: MAX_RELAYS + 1 }, (_, i) => `wss://r${i}.example`).join('\n');
    expect(parseTarget({ pubkey: npub, relays: many })).toBe('At most 8 relays.');
  });
});

describe('profileRelays', () => {
  it('reads the relays of an nprofile only', () => {
    expect(profileRelays(nprofile)).toEqual(['wss://relay.example.com']);
    expect(profileRelays(nip19.nprofileEncode({ pubkey: ADMIN_PUBKEY }))).toEqual([]);
    expect(profileRelays(npub)).toEqual([]);
    expect(profileRelays('not a key')).toEqual([]);
  });
});

describe('the remembered target', () => {
  it('is saved trimmed and read back', () => {
    saveTarget({ pubkey: ` ${npub} `, relays: `${RELAY}\n` }, localStorage);
    expect(loadTarget(localStorage)).toEqual({ pubkey: npub, relays: RELAY });
  });

  it('starts empty when nothing or something unreadable is stored', () => {
    localStorage.clear();
    expect(loadTarget()).toEqual({ pubkey: '', relays: '' });
    for (const v of ['{', '"text"', '{"pubkey":1,"relays":""}', 'null']) {
      localStorage.setItem('deadhop-console:target', v);
      expect(loadTarget()).toEqual({ pubkey: '', relays: '' });
    }
    saveTarget({ pubkey: 'a', relays: 'b' });
    expect(loadTarget()).toEqual({ pubkey: 'a', relays: 'b' });
  });
});
