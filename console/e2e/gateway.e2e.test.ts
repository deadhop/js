// The console against a real lnaddr gateway (#121): sign in to its admin key
// over ContextVM, read everything the console's views read and validate it
// with the console's own schemas, save a change, and check that a key not in
// the gateway's `admins` is refused. The gateway needs no node to answer for
// this. Requires `just up` (the relay) and an lnaddr-gateway binary
// (LNADDR_GATEWAY_BIN, or a build under lnaddr/target).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSigner } from '@deadhop/client';
import { connect, type Session } from '../src/lib/api';
import { NetworkHealthSchema, NetworkViewSchema } from '../src/lib/schemas';

const RELAY = 'ws://127.0.0.1:7777';
const root = resolve(import.meta.dirname, '../..');
const hex = (k: Uint8Array) => Buffer.from(k).toString('hex');

/** Where the gateway binary is: LNADDR_GATEWAY_BIN, else a build under lnaddr/target. */
function gatewayBinary(): string | null {
  const candidates = [process.env.LNADDR_GATEWAY_BIN, resolve(root, 'lnaddr/target/release/lnaddr-gateway'), resolve(root, 'lnaddr/target/debug/lnaddr-gateway')];
  return candidates.find((c): c is string => c !== undefined && existsSync(c)) ?? null;
}

const binary = gatewayBinary();

describe.skipIf(binary === null)('the console and an lnaddr gateway', () => {
  const admin = generateSecretKey();
  const stranger = generateSecretKey();
  const node = getPublicKey(generateSecretKey());
  const dir = mkdtempSync(join(tmpdir(), 'lnaddr-gateway-console-'));
  const env = {
    ...process.env,
    LNADDR_GATEWAY_DATA_DIR: dir,
    LNADDR_GATEWAY_LISTEN: '127.0.0.1:0',
    LNADDR_GATEWAY_DOMAIN: 'pay.example',
    LNADDR_GATEWAY_NODE: node,
    LNADDR_GATEWAY_RELAYS: RELAY,
    LNADDR_GATEWAY_ADMINS: getPublicKey(admin),
    LNADDR_GATEWAY_REMOTE: 'on',
  };
  let gateway: ChildProcess;
  let serverPubkey = '';
  let session: Session;

  beforeAll(async () => {
    // The console signs in to the gateway's admin key.
    const npub = execFileSync(binary!, ['admin-pubkey'], { env }).toString().trim();
    serverPubkey = nip19.decode(npub).data as string;
    gateway = spawn(binary!, [], { env, stdio: ['ignore', 'ignore', 'inherit'] });
    // The gateway takes a moment to reach the relay; signing in retries until it answers.
    for (let i = 0; ; i++) {
      try {
        session = await connect(localSigner(hex(admin)), { serverPubkey, relays: [RELAY] }, 10_000);
        break;
      } catch (e) {
        if (i >= 9) throw e;
      }
    }
  }, 150_000);

  afterAll(async () => {
    await session?.close();
    gateway?.kill();
  });

  it('signs in as an admin', () => {
    expect(session.info.is_admin).toBe(true);
    expect(session.info.name).toBe('deadhop lnaddr gateway');
  });

  it('answers every view with what the console expects', async () => {
    const network = await session.api.getNetwork();
    NetworkViewSchema.parse(network);
    expect(network.settings.relays).toEqual([RELAY]);
    expect(network.keys.map((k) => k.id)).toEqual(['gateway', 'admin']);
    const health = await session.api.getHealth();
    NetworkHealthSchema.parse(health);
    expect(health.proxy_pool).toBeDefined();
    // A check already running (the gateway checks its relays when it starts)
    // answers "rate limited"; the console says so and lets the operator retry.
    for (let i = 0; ; i++) {
      try {
        await session.api.checkRelays();
        break;
      } catch (e) {
        if (i >= 10 || !String(e).includes('Too many')) throw e;
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    await session.api.getRelayHistory('1h');
    const audit = await session.api.getPrivacyAudit();
    expect(JSON.stringify(audit)).not.toContain('DEADHOP_');
  });

  it('saves a relay name and reads it back', async () => {
    const saved = await session.api.updateNetwork({ relay_names: { [RELAY]: 'Local relay' } });
    expect(saved.settings.relay_names[RELAY]).toBe('Local relay');
    expect((await session.api.getNetwork()).settings.relay_names[RELAY]).toBe('Local relay');
  });

  it('refuses a relay list that leaves the node without a relay in common', async () => {
    await expect(session.api.updateNetwork({ relays: ['ws://127.0.0.1:7778'] })).rejects.toThrow();
    expect((await session.api.getNetwork()).settings.relays).toEqual([RELAY]);
  });

  it('refuses a key that is not one of its admins', async () => {
    await expect(connect(localSigner(hex(stranger)), { serverPubkey, relays: [RELAY] }, 30_000)).rejects.toThrow();
  });
});
