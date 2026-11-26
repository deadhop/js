// The console against a real lnaddr node (#85): sign in with an admin key over
// ContextVM, read everything the console's views read and validate it with
// the console's own schemas, save a change, and check that a gateway key is
// refused. No browser: the views are covered by console.e2e.test.ts; this is
// the wire between them and the node. Requires `just up` (the relay) and an
// lnaddr-node binary (LNADDR_NODE_BIN, or a build under lnaddr/target).
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSigner } from '@deadhop/client';
import { connect, type Session } from '../src/lib/api';

const RELAY = 'ws://127.0.0.1:7777';
// This repository, and the deadhop workspace around it (the regtest stack,
// data/dev and the server and lnaddr builds): set DEADHOP_WORKSPACE when it is elsewhere.
const js = resolve(import.meta.dirname, '../..');
const root = process.env.DEADHOP_WORKSPACE ?? resolve(js, '..');
const hex = (k: Uint8Array) => Buffer.from(k).toString('hex');

/** Where the node binary is: LNADDR_NODE_BIN, else a build under lnaddr/target. */
function nodeBinary(): string | null {
  const candidates = [process.env.LNADDR_NODE_BIN, resolve(root, 'lnaddr/target/release/lnaddr-node'), resolve(root, 'lnaddr/target/debug/lnaddr-node')];
  return candidates.find((c): c is string => c !== undefined && existsSync(c)) ?? null;
}

const binary = nodeBinary();

describe.skipIf(binary === null)('the console and an lnaddr node', () => {
  const admin = generateSecretKey();
  const gateway = generateSecretKey();
  const dir = mkdtempSync(join(tmpdir(), 'lnaddr-console-'));
  const env = {
    ...process.env,
    LNADDR_NODE_DATA_DIR: dir,
    LNADDR_NODE_RELAYS: RELAY,
    LNADDR_NODE_ADMINS: getPublicKey(admin),
    LNADDR_NODE_GATEWAYS: getPublicKey(gateway),
    LNADDR_NODE_BACKEND: 'phoenixd',
    LNADDR_NODE_BACKEND_SECRET: 'x',
    LNADDR_NODE_ADDRESSES: 'alice',
    LNADDR_NODE_REMOTE: 'true',
  };
  let node: ChildProcess;
  let serverPubkey = '';
  let session: Session;

  beforeAll(async () => {
    const npub = execFileSync(binary!, ['pubkey'], { env }).toString().trim();
    serverPubkey = nip19.decode(npub).data as string;
    node = spawn(binary!, [], { env, stdio: ['ignore', 'ignore', 'inherit'] });
    // The node takes a moment to reach the relay; signing in retries until it answers.
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
    node?.kill();
  });

  it('signs in as an admin', () => {
    expect(session.info.is_admin).toBe(true);
  });

  it('answers every view with what the console expects', async () => {
    const network = await session.api.getNetwork();
    expect(network.settings.relays).toEqual([RELAY]);
    const health = await session.api.getHealth();
    expect(health.proxy_pool).toBeDefined();
    // A check already running (the node checks its relays when it starts)
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

  it('refuses a gateway key', async () => {
    await expect(connect(localSigner(hex(gateway)), { serverPubkey, relays: [RELAY] }, 30_000)).rejects.toThrow();
  });
});
