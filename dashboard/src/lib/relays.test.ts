import { describe, expect, it } from 'vitest';
import { errorRate, i2pName, isOverlayHost, lookupLine, registryHost, relayProblem, statsFor, withHost } from './relays';
import { B32, REGISTRIES, i2pLookup, relayHistory, relayStats } from '../test-helpers';

describe('relay history helpers', () => {
  it('match a relay by address, with or without a trailing slash', () => {
    const history = relayHistory({ relays: [relayStats({ relay: 'wss://a.example/' }), relayStats({ relay: 'wss://b.example' })] });
    expect(statsFor(history, 'wss://a.example')?.relay).toBe('wss://a.example/');
    expect(statsFor(history, 'wss://b.example/')?.relay).toBe('wss://b.example');
    expect(statsFor(history, 'wss://c.example')).toBeNull();
    expect(statsFor(null, 'wss://a.example')).toBeNull();
  });

  it('turn failures into a rate and a colour', () => {
    expect(errorRate(relayStats({ checks: 0, sends: 0, check_failures: 0, send_failures: 0 }))).toMatchObject({ text: '—', tone: 'none' });
    expect(errorRate(relayStats({ checks: 5, sends: 15, check_failures: 0, send_failures: 0 }))).toMatchObject({ text: '0%', tone: 'ok' });
    expect(errorRate(relayStats({ checks: 10, sends: 30, check_failures: 1, send_failures: 0 }))).toMatchObject({ failed: 1, total: 40, text: '2.5%', tone: 'warn' });
    expect(errorRate(relayStats({ checks: 5, sends: 5, check_failures: 1, send_failures: 1 }))).toMatchObject({ text: '20%', tone: 'bad' });
    expect(errorRate(relayStats({ checks: 4, sends: 0, check_failures: 4, send_failures: 0 }))).toMatchObject({ text: '100%', tone: 'bad' });
  });
});

describe('relayProblem', () => {
  const ok = (url: string, net = 'bitcoin', listed: string[] = []) => expect(relayProblem(url, net, listed)).toBe('');
  const bad = (url: string, why: RegExp, net = 'bitcoin', listed: string[] = []) => expect(relayProblem(url, net, listed)).toMatch(why);

  it('takes wss:// anywhere, and plain ws:// for this machine on any network', () => {
    ok('wss://relay.example');
    ok('ws://127.0.0.1:7777');
    ok('ws://localhost:7777');
    ok('ws://[::1]:7777/path');
    ok('ws://relay.example', 'regtest');
  });

  it('takes plain ws:// on mainnet for Tor, I2P and FIPS, which encrypt the connection themselves', () => {
    ok('ws://4ajy63hxt5hui5o4zg5ep675p2jtjuolyhpzfjjueyfdh3p6gvzpk6id.onion/');
    ok('ws://abc.b32.i2p:80');
    ok('ws://npub1abc.fips:7777');
    ok('ws://ABC.ONION.');
  });

  it('says why an address is refused', () => {
    bad('https://nope', /starts with wss:\/\//);
    bad('wss://a b.example', /no spaces/);
    bad('wss://', /not a valid relay address/);
    bad('ws://relay.example', /On mainnet a relay must use wss:\/\/.*\.onion, \.i2p and \.fips/);
    bad('wss://user@relay.example', /user name or password/);
    bad('wss://relay.example', /already listed/, 'bitcoin', ['wss://relay.example/']);
  });

  it('does not let a look-alike host pass for an overlay or local one', () => {
    for (const spoof of ['ws://a.onion.example', 'ws://onion', 'ws://a.fips.example.com', 'ws://x.i2px', 'ws://127.0.0.1.example']) bad(spoof, /must use wss:\/\//);
    bad('ws://127.0.0.1:80@evil.example', /user name or password/);
    expect(isOverlayHost('a.onion')).toBe(true);
    expect(isOverlayHost('onion')).toBe(false);
  });
});

describe('I2P names', () => {
  it('reads a name from a relay address, not a b32 address', () => {
    expect(i2pName(' ws://Nostr-Not.i2p:7777/path ')).toBe('nostr-not.i2p');
    expect(i2pName(`ws://${B32}`)).toBeNull();
    expect(i2pName('wss://relay.example')).toBeNull();
    expect(i2pName('nostr-not.i2p')).toBeNull();
  });

  it('swaps the host and keeps the rest', () => {
    expect(withHost('ws://nostr-not.i2p:7777/a?b', B32)).toBe(`ws://${B32}:7777/a?b`);
    expect(withHost(' wss://nostr-not.i2p ', B32)).toBe(`wss://${B32}`);
  });

  it('says what a lookup found in one line', () => {
    expect(registryHost(REGISTRIES[0])).toBe('notbob.i2p');
    expect(registryHost('http://reg.i2p?q={name}')).toBe('reg.i2p');
    expect(lookupLine(i2pLookup())).toBe(`nostr-not.i2p → ${B32} (from notbob.i2p; stats.i2p doesn't know it)`);
    expect(lookupLine(i2pLookup({ agreeing: REGISTRIES, unknown: [] }))).toBe(`nostr-not.i2p → ${B32} (from notbob.i2p and stats.i2p)`);
    const three = ['http://a.i2p/{name}', 'http://b.i2p/{name}', 'http://c.i2p/{name}'];
    expect(lookupLine(i2pLookup({ unknown: three }))).toContain('a.i2p, b.i2p and c.i2p don\'t know it');
  });
});
