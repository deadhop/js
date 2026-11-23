// A private deadhop service for the console's end-to-end test: its own data
// directory and operator key, the dev relay and Electrum server (`just up`),
// and a fresh production build of the console served by Vite's preview server.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { preview, type PreviewServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
export const consoleDir = resolve(here, '..');
const root = resolve(consoleDir, '..');

export interface Stack {
  /** Where the console is served. */
  url: string;
  /** The operator's secret key. */
  nsec: string;
  /** The service's administration key (hex). */
  adminPubkey: string;
  stop(): Promise<void>;
}

/** Where the service binary is: DEADHOP_BIN, else a build under server/target. */
export function serverBinary(): string | null {
  const candidates = [process.env.DEADHOP_BIN, resolve(root, 'server/target/release/deadhop'), resolve(root, 'server/target/debug/deadhop')];
  return candidates.find((p): p is string => !!p && existsSync(p)) ?? null;
}

export async function startStack(binary: string): Promise<Stack> {
  const dir = mkdtempSync(join(tmpdir(), 'deadhop-console-'));
  const secret = generateSecretKey();

  const child: ChildProcess = spawn(binary, [], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      PATH: process.env.PATH,
      DEADHOP_NAME: 'deadhop (console)',
      DEADHOP_RELAYS: 'ws://127.0.0.1:7777',
      DEADHOP_ELECTRUM: '127.0.0.1:50001',
      DEADHOP_NETWORK: 'regtest',
      DEADHOP_XPUB: readFileSync(resolve(root, 'data/dev/xpub'), 'utf8').trim(),
      DEADHOP_ADMINS: getPublicKey(secret),
      DEADHOP_PUBLIC_INVOICING: 'true',
      DEADHOP_POW_BITS: '8',
      DEADHOP_POLL_SECS: '2',
      DEADHOP_DATA_DIR: join(dir, 'server'),
    },
  });
  const adminFile = join(dir, 'server', 'admin.pubkey');
  for (let i = 0; i < 150 && !existsSync(adminFile); i++) await new Promise((r) => setTimeout(r, 200));
  const adminPubkey = readFileSync(adminFile, 'utf8').trim();

  const out = join(dir, 'dist');
  const buildEnv = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production' };
  execFileSync('npx', ['vite', 'build', '--logLevel', 'error', '--outDir', out, '--emptyOutDir'], { cwd: consoleDir, stdio: 'inherit', env: buildEnv });
  const web: PreviewServer = await preview({ root: consoleDir, build: { outDir: out }, logLevel: 'error', preview: { port: 0, host: '127.0.0.1' } });

  return {
    url: web.resolvedUrls!.local[0],
    nsec: nip19.nsecEncode(secret),
    adminPubkey,
    async stop() {
      child.kill('SIGTERM');
      await new Promise((ok) => web.httpServer.close(() => ok(undefined)));
    },
  };
}
