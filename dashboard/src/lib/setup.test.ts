import { describe, expect, it, vi } from 'vitest';
import { nip19 } from 'nostr-tools';
import {
  FORMATS,
  accountKeyError,
  addOperator,
  electrumError,
  fileName,
  firstAddress,
  found,
  isLocal,
  isProxy,
  isRelay,
  isTls,
  loadSetup,
  parseFingerprint,
  problems,
  render,
  settings,
  type Answers,
} from './setup';
import { PUBKEY, ADMIN_PUBKEY, STATUS, ZPUB, TPUB, XPUB, b58, withVersion } from '../test-helpers';

const ZPUB_ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const VPUB = withVersion(TPUB, 0x045f1cf6);

const answers = (over: Partial<Answers> = {}): Answers => ({
  network: 'bitcoin',
  wallet: 'service',
  xpub: '',
  electrum: 'tls://electrum.example:50002',
  fingerprint: '',
  operators: [{ pubkey: PUBKEY, source: 'pasted', label: '' }],
  publicInvoicing: false,
  powBits: 20,
  relays: ['wss://relay.example'],
  name: '',
  proxy: '',
  ...over,
});

describe('setup.json', () => {
  const respond = (body: unknown, ok = true) => vi.fn(async () => ({ ok, json: async () => body }) as Response);

  it('is read when the service waits for its settings', async () => {
    const fetcher = respond(STATUS);
    expect(await loadSetup(fetcher)).toEqual(STATUS);
    expect(fetcher).toHaveBeenCalledWith('setup.json', { cache: 'no-store' });
    expect(found(STATUS, 'DEADHOP_XPUB')).toBe(true);
    expect(found(STATUS, 'DEADHOP_ADMINS')).toBe(false);
  });

  it('is nothing when absent, malformed or unreachable', async () => {
    expect(await loadSetup(respond(STATUS, false))).toBeNull();
    expect(await loadSetup(respond({ version: 2 }))).toBeNull();
    expect(await loadSetup(vi.fn(async () => Promise.reject(new Error('offline'))))).toBeNull();
  });
});

describe('validation', () => {
  it('accepts the Electrum addresses the service accepts', () => {
    for (const ok of ['127.0.0.1:50001', 'tcp://node:50001', 'tls://node.lan:50002', 'ssl://a.onion:50002', '[::1]:50001']) expect(electrumError(ok)).toBe('');
    expect(electrumError(' ')).toBe('Enter the Electrum server.');
    for (const bad of ['node', 'node:99999', 'http://node:1', 'no de:1']) expect(electrumError(bad)).toBe('Use host:port, or tls://host:port.');
    expect(isTls('tls://a:1')).toBe(true);
    expect(isTls('ssl://a:1')).toBe(true);
    expect(isTls('a:1')).toBe(false);
    expect(isLocal('127.0.0.1:50001')).toBe(true);
    expect(isLocal('tcp://localhost:1')).toBe(true);
    expect(isLocal('[::1]:1')).toBe(true);
    expect(isLocal('node.lan:1')).toBe(false);
  });

  it('reads fingerprints, relays and proxies', () => {
    const fp = 'AB'.repeat(32);
    expect(parseFingerprint(fp)).toBe('ab'.repeat(32));
    expect(parseFingerprint(fp.match(/../g)!.join(':'))).toBe('ab'.repeat(32));
    expect(parseFingerprint('abc')).toBeNull();
    expect(isRelay('wss://relay.example')).toBe(true);
    expect(isRelay('ws://127.0.0.1:7777')).toBe(true);
    expect(isRelay('https://relay.example')).toBe(false);
    expect(isProxy('socks5h://127.0.0.1:9050')).toBe(true);
    expect(isProxy('socks5://tor:9050')).toBe(true);
    expect(isProxy('http://tor:9050')).toBe(false);
  });

  it('checks account keys against the network', () => {
    expect(accountKeyError(ZPUB, 'bitcoin')).toBe('');
    expect(accountKeyError(XPUB, 'bitcoin')).toBe('');
    expect(accountKeyError(TPUB, 'regtest')).toBe('');
    expect(accountKeyError(VPUB, 'signet')).toBe('');
    expect(accountKeyError(ZPUB, 'testnet')).toBe('This key is for mainnet.');
    expect(accountKeyError(TPUB, 'bitcoin')).toBe('This key is for a test network.');
    expect(accountKeyError('nope', 'bitcoin')).toBe('This is not an extended public key.');
    // A ypub (P2SH-wrapped) is not what the service hands out addresses for.
    expect(accountKeyError(withVersion(XPUB, 0x049d7cb2), 'bitcoin')).toBe('Use an xpub or zpub (tpub or vpub off mainnet).');
    expect(accountKeyError(b58.encode(new Uint8Array(10)), 'bitcoin')).toBe('Use an xpub or zpub (tpub or vpub off mainnet).');
  });

  it('derives the first receive address the service hands out', () => {
    expect(firstAddress(ZPUB, 'bitcoin')).toBe(ZPUB_ADDRESS);
    // xpub and zpub are the same key, so the same address.
    expect(firstAddress(withVersion(ZPUB, 0x0488b21e), 'bitcoin')).toBe(ZPUB_ADDRESS);
    expect(firstAddress(TPUB, 'regtest')).toMatch(/^bcrt1q[02-9ac-hj-np-z]{38}$/);
    expect(firstAddress(VPUB, 'signet')).toBe(firstAddress(TPUB, 'testnet'));
    expect(firstAddress(TPUB, 'testnet')).toMatch(/^tb1q/);
  });
});

describe('operators', () => {
  it('are added once, from hex, npub or nprofile', () => {
    let list = addOperator([], PUBKEY, 'pasted')!;
    expect(list).toEqual([{ pubkey: PUBKEY, source: 'pasted', label: '' }]);
    expect(addOperator(list, nip19.npubEncode(PUBKEY), 'extension')).toBe(list);
    list = addOperator(list, nip19.nprofileEncode({ pubkey: ADMIN_PUBKEY }), 'passkey', 'Laptop')!;
    expect(list[1]).toEqual({ pubkey: ADMIN_PUBKEY, source: 'passkey', label: 'Laptop' });
    expect(addOperator(list, 'nope', 'pasted')).toBeNull();
  });
});

describe('settings', () => {
  it('lists what is left to answer, by step', () => {
    expect(problems(answers())).toEqual([]);
    expect(problems(answers({ wallet: 'own' }))).toEqual([{ step: 1, text: 'Enter the account key.' }]);
    expect(problems(answers({ wallet: 'own', xpub: TPUB }))).toEqual([{ step: 1, text: 'This key is for a test network.' }]);
    expect(problems(answers({ wallet: 'own', xpub: ZPUB }))).toEqual([]);
    expect(problems(answers({ electrum: '' }))).toEqual([{ step: 2, text: 'Enter the Electrum server.' }]);
    expect(problems(answers({ fingerprint: 'abc' }))).toEqual([{ step: 2, text: 'The fingerprint is 64 hex characters.' }]);
    expect(problems(answers({ electrum: '127.0.0.1:1', fingerprint: 'ab'.repeat(32) }))).toEqual([{ step: 2, text: 'A fingerprint needs a tls:// server.' }]);
    expect(problems(answers({ operators: [] }))).toEqual([{ step: 3, text: 'Add an operator, or let anyone create invoices.' }]);
    expect(problems(answers({ operators: [], publicInvoicing: true }))).toEqual([]);
    expect(problems(answers({ relays: [] }))).toEqual([{ step: 4, text: 'Add a relay.' }]);
    expect(problems(answers({ proxy: 'tor' }))).toEqual([{ step: 4, text: 'The proxy is socks5://host:port.' }]);
  });

  it('leave defaults out', () => {
    expect(settings(answers())).toEqual([
      ['DEADHOP_NETWORK', 'bitcoin'],
      ['DEADHOP_ELECTRUM', 'tls://electrum.example:50002'],
      ['DEADHOP_ADMINS', PUBKEY],
      ['DEADHOP_RELAYS', 'wss://relay.example'],
    ]);
  });

  it('include every answer that differs from a default', () => {
    const all = settings(
      answers({
        wallet: 'own',
        xpub: ` ${ZPUB} `,
        fingerprint: 'AB'.repeat(32),
        operators: [
          { pubkey: PUBKEY, source: 'pasted', label: '' },
          { pubkey: ADMIN_PUBKEY, source: 'passkey', label: '' },
        ],
        publicInvoicing: true,
        powBits: 16,
        relays: ['wss://a', ' wss://b '],
        name: ' My shop ',
        proxy: 'socks5h://127.0.0.1:9050',
      }),
    );
    expect(Object.fromEntries(all)).toEqual({
      DEADHOP_NETWORK: 'bitcoin',
      DEADHOP_XPUB: ZPUB,
      DEADHOP_ELECTRUM: 'tls://electrum.example:50002',
      DEADHOP_ELECTRUM_CERT_SHA256: 'ab'.repeat(32),
      DEADHOP_ADMINS: `${PUBKEY},${ADMIN_PUBKEY}`,
      DEADHOP_PUBLIC_INVOICING: 'true',
      DEADHOP_POW_BITS: '16',
      DEADHOP_RELAYS: 'wss://a,wss://b',
      DEADHOP_NAME: 'My shop',
      DEADHOP_PROXY: 'socks5h://127.0.0.1:9050',
    });
    // The default work is left out.
    expect(Object.fromEntries(settings(answers({ publicInvoicing: true })))).not.toHaveProperty('DEADHOP_POW_BITS');
  });
});

describe('formats', () => {
  const pairs: [string, string][] = [
    ['DEADHOP_RELAYS', 'wss://a,wss://b'],
    ['DEADHOP_NAME', `Bob's "shop" \\ 1`],
  ];

  it('write each target the way it reads values', () => {
    expect(render(pairs, 'env')).toBe(`# deadhop settings, made by the setup page\nDEADHOP_RELAYS=wss://a,wss://b\nDEADHOP_NAME="Bob's \\"shop\\" \\\\ 1"\n`);
    expect(render(pairs, 'coolify')).toBe(`DEADHOP_RELAYS=wss://a,wss://b\nDEADHOP_NAME=Bob's "shop" \\ 1\n`);
    expect(render(pairs, 'compose')).toBe(
      `services:\n  deadhop:\n    environment:\n      DEADHOP_RELAYS: "wss://a,wss://b"\n      DEADHOP_NAME: "Bob's \\"shop\\" \\\\ 1"\n`,
    );
    expect(render(pairs, 'systemd')).toBe(`[Service]\nEnvironment="DEADHOP_RELAYS=wss://a,wss://b"\nEnvironment="DEADHOP_NAME=Bob's \\"shop\\" \\\\ 1"\n`);
    expect(render(pairs, 'shell')).toBe(`export DEADHOP_RELAYS=wss://a,wss://b\nexport DEADHOP_NAME='Bob'\\''s "shop" \\ 1'\n`);
    expect(render(pairs, 'kubernetes')).toBe(
      `apiVersion: v1\nkind: Secret\nmetadata:\n  name: deadhop-settings\ntype: Opaque\nstringData:\n  DEADHOP_RELAYS: "wss://a,wss://b"\n  DEADHOP_NAME: "Bob's \\"shop\\" \\\\ 1"\n`,
    );
  });

  it('keep $ and % literal where the target would expand them', () => {
    const odd: [string, string][] = [['DEADHOP_NAME', '50% off $5']];
    expect(render(odd, 'env')).toContain('DEADHOP_NAME="50% off $$5"');
    expect(render(odd, 'compose')).toContain('DEADHOP_NAME: "50% off $$5"');
    expect(render(odd, 'systemd')).toContain('Environment="DEADHOP_NAME=50%% off $5"');
    expect(render(odd, 'shell')).toContain("export DEADHOP_NAME='50% off $5'");
    expect(render(odd, 'kubernetes')).toContain('DEADHOP_NAME: "50% off $5"');
  });

  it('name a file for each', () => {
    expect(FORMATS.map(fileName)).toEqual(['.env', 'deadhop.env', 'compose.override.yaml', 'deadhop.conf', 'deadhop.sh', 'deadhop-settings.yaml']);
  });
});
