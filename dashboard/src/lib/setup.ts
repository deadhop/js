// Setup mode: what a service that has never been set up tells the dashboard
// (`setup.json`), and the settings the setup page builds from the answers.
//
// Everything here runs in the browser and nothing is sent anywhere: the page
// ends with text the operator pastes into their host.
import { z } from 'zod';
import { bech32, createBase58check } from '@scure/base';
import { HDKey } from '@scure/bip32';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { normalizePubkey } from './schemas';

export const NETWORKS = ['bitcoin', 'testnet', 'signet', 'regtest'] as const;
export type Network = (typeof NETWORKS)[number];

const SetupSchema = z.object({
  version: z.literal(1),
  network: z.enum(NETWORKS),
  settings: z
    .array(
      z.object({
        name: z.string().regex(/^DEADHOP_[A-Z0-9_]+$/),
        state: z.enum(['missing', 'found', 'default']),
        about: z.string().max(200),
      }),
    )
    .max(32),
});
export type SetupStatus = z.infer<typeof SetupSchema>;

/**
 * `setup.json`, which the service writes next to the dashboard while it waits
 * for its settings; `null` when there is none (the service is set up, or is
 * not on this host).
 */
export async function loadSetup(fetcher: typeof fetch = fetch): Promise<SetupStatus | null> {
  try {
    const res = await fetcher('setup.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const parsed = SetupSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Whether the service reported a setting as given. */
export const found = (s: SetupStatus, name: string): boolean => s.settings.some((x) => x.name === name && x.state === 'found');

// ---- Validation, mirroring what the service accepts ----

/** `host:port`, with an optional `tcp://`, `tls://` or `ssl://`. */
export function electrumError(spec: string): string {
  const s = spec.trim();
  if (s === '') return 'Enter the Electrum server.';
  const m = /^(?:(tcp|tls|ssl):\/\/)?([^\s:/]+|\[[0-9a-fA-F:]+\]):(\d{1,5})$/.exec(s);
  if (!m || Number(m[3]) > 65535) return 'Use host:port, or tls://host:port.';
  return '';
}

/** Whether the Electrum connection is TLS. */
export const isTls = (spec: string): boolean => /^(tls|ssl):\/\//.test(spec.trim());

/** Whether plain TCP stays on this machine (the service warns otherwise). */
export function isLocal(spec: string): boolean {
  const host = spec.trim().replace(/^tcp:\/\//, '').replace(/:\d+$/, '');
  return host === 'localhost' || host === '[::1]' || host.startsWith('127.');
}

/** A SHA-256 fingerprint, as `deadhop fingerprint` prints it (colons allowed): lowercase hex, or `null`. */
export function parseFingerprint(input: string): string | null {
  const hex = input.trim().replace(/:/g, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

/** A relay url the service accepts. */
export const isRelay = (url: string): boolean => /^wss?:\/\/[^\s,]+$/.test(url.trim());

/** A SOCKS5 proxy url (`socks5://host:port` or `socks5h://…`). */
export const isProxy = (url: string): boolean => /^socks5h?:\/\/[^\s,/]+:\d{1,5}$/.test(url.trim());

// ---- Account keys ----

const base58check = createBase58check(sha256);

// Version bytes: xpub and zpub on mainnet, tpub and vpub elsewhere.
const MAINNET_VERSIONS = [0x0488b21e, 0x04b24746];
const TEST_VERSIONS = [0x043587cf, 0x045f1cf6];
const HRP: Record<Network, string> = { bitcoin: 'bc', testnet: 'tb', signet: 'tb', regtest: 'bcrt' };

/** Why an account key cannot be used on `network`, or '' when it can. */
export function accountKeyError(key: string, network: Network): string {
  let raw: Uint8Array;
  try {
    raw = base58check.decode(key.trim());
  } catch {
    return 'This is not an extended public key.';
  }
  const version = new DataView(raw.buffer, raw.byteOffset).getUint32(0);
  if (raw.length !== 78 || ![...MAINNET_VERSIONS, ...TEST_VERSIONS].includes(version)) return 'Use an xpub or zpub (tpub or vpub off mainnet).';
  const want = network === 'bitcoin' ? MAINNET_VERSIONS : TEST_VERSIONS;
  if (!want.includes(version)) return `This key is for ${network === 'bitcoin' ? 'a test network' : 'mainnet'}.`;
  return '';
}

/**
 * The first receive address (`<account>/0/0`, P2WPKH), as the service hands
 * it out: the operator checks that their wallet lists it.
 */
export function firstAddress(key: string, network: Network): string {
  const raw = base58check.decode(key.trim());
  const version = new DataView(raw.buffer, raw.byteOffset).getUint32(0);
  const node = HDKey.fromExtendedKey(key.trim(), { public: version, private: 0 }).deriveChild(0).deriveChild(0);
  const hash = ripemd160(sha256(node.publicKey!));
  return bech32.encode(HRP[network], [0, ...bech32.toWords(hash)]);
}

// ---- Answers and the settings they make ----

export type OperatorSource = 'pasted' | 'extension' | 'passkey';
export interface Operator {
  pubkey: string;
  source: OperatorSource;
  label: string;
}

export interface Answers {
  network: Network;
  /** Keep the account key the wallet service made, or give one. */
  wallet: 'service' | 'own';
  xpub: string;
  electrum: string;
  fingerprint: string;
  operators: Operator[];
  publicInvoicing: boolean;
  powBits: number;
  relays: string[];
  name: string;
  proxy: string;
}

export const DEFAULT_POW_BITS = 20;

/** Add an operator once; `null` when the key is not a nostr public key. */
export function addOperator(list: Operator[], input: string, source: OperatorSource, label = ''): Operator[] | null {
  const pubkey = normalizePubkey(input);
  if (pubkey === null) return null;
  if (list.some((o) => o.pubkey === pubkey)) return list;
  return [...list, { pubkey, source, label }];
}

/** What still has to be answered, step by step; empty when the settings are complete. */
export function problems(a: Answers): { step: number; text: string }[] {
  const out: { step: number; text: string }[] = [];
  if (a.wallet === 'own') {
    const e = a.xpub.trim() === '' ? 'Enter the account key.' : accountKeyError(a.xpub, a.network);
    if (e) out.push({ step: 1, text: e });
  }
  const e = electrumError(a.electrum);
  if (e) out.push({ step: 2, text: e });
  if (a.fingerprint.trim() !== '' && (!isTls(a.electrum) || parseFingerprint(a.fingerprint) === null))
    out.push({ step: 2, text: isTls(a.electrum) ? 'The fingerprint is 64 hex characters.' : 'A fingerprint needs a tls:// server.' });
  if (a.operators.length === 0 && !a.publicInvoicing) out.push({ step: 3, text: 'Add an operator, or let anyone create invoices.' });
  if (a.relays.length === 0) out.push({ step: 4, text: 'Add a relay.' });
  if (a.proxy.trim() !== '' && !isProxy(a.proxy)) out.push({ step: 4, text: 'The proxy is socks5://host:port.' });
  return out;
}

/** The settings, in order. Defaults are left out so the block stays short. */
export function settings(a: Answers): [string, string][] {
  const out: [string, string][] = [['DEADHOP_NETWORK', a.network]];
  if (a.wallet === 'own') out.push(['DEADHOP_XPUB', a.xpub.trim()]);
  out.push(['DEADHOP_ELECTRUM', a.electrum.trim()]);
  const pin = parseFingerprint(a.fingerprint);
  if (pin !== null) out.push(['DEADHOP_ELECTRUM_CERT_SHA256', pin]);
  if (a.operators.length > 0) out.push(['DEADHOP_ADMINS', a.operators.map((o) => o.pubkey).join(',')]);
  if (a.publicInvoicing) {
    out.push(['DEADHOP_PUBLIC_INVOICING', 'true']);
    if (a.powBits !== DEFAULT_POW_BITS) out.push(['DEADHOP_POW_BITS', String(a.powBits)]);
  }
  out.push(['DEADHOP_RELAYS', a.relays.map((r) => r.trim()).join(',')]);
  if (a.name.trim() !== '') out.push(['DEADHOP_NAME', a.name.trim()]);
  if (a.proxy.trim() !== '') out.push(['DEADHOP_PROXY', a.proxy.trim()]);
  return out;
}

// ---- Formats ----

export const FORMATS = ['env', 'coolify', 'compose', 'systemd', 'shell', 'kubernetes'] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABELS: Record<Format, string> = {
  env: '.env / Docker Compose',
  coolify: 'Coolify',
  compose: 'compose environment:',
  systemd: 'systemd',
  shell: 'Shell export',
  kubernetes: 'Kubernetes',
};
export const FORMAT_HINTS: Record<Format, string> = {
  env: 'Save as .env next to compose.yaml, then run docker compose up -d.',
  coolify: "Paste into the resource's Environment Variables, in the Developer view, then redeploy.",
  compose: 'Save as compose.override.yaml next to compose.yaml; Compose merges it. Only the deadhop service gets these: with the wallet service, prefer .env.',
  systemd: 'Put in a drop-in (systemctl edit deadhop), then systemctl restart deadhop.',
  shell: 'Run before starting the deadhop binary, in the same shell.',
  kubernetes: 'kubectl apply -f this file, and load it with envFrom: - secretRef: name: deadhop-settings.',
};

// A value that needs no quoting in a .env file or a shell.
const plain = (v: string) => /^[A-Za-z0-9_./:,@+=-]*$/.test(v);
const dq = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const sq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

/** The settings written for `format`. */
export function render(pairs: [string, string][], format: Format): string {
  switch (format) {
    case 'env':
      return ['# deadhop settings, made by the setup page', ...pairs.map(([k, v]) => `${k}=${plain(v) ? v : dq(v)}`)].join('\n') + '\n';
    case 'coolify':
      return pairs.map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    case 'compose':
      return ['services:', '  deadhop:', '    environment:', ...pairs.map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)].join('\n') + '\n';
    case 'systemd':
      return ['[Service]', ...pairs.map(([k, v]) => `Environment=${dq(`${k}=${v}`)}`)].join('\n') + '\n';
    case 'shell':
      return pairs.map(([k, v]) => `export ${k}=${plain(v) ? v : sq(v)}`).join('\n') + '\n';
    case 'kubernetes':
      return (
        [
          'apiVersion: v1',
          'kind: Secret',
          'metadata:',
          '  name: deadhop-settings',
          'type: Opaque',
          'stringData:',
          ...pairs.map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`),
        ].join('\n') + '\n'
      );
  }
}

/** File name for the download of `format`. */
export const fileName = (format: Format): string =>
  ({ env: '.env', coolify: 'deadhop.env', compose: 'compose.override.yaml', systemd: 'deadhop.conf', shell: 'deadhop.sh', kubernetes: 'deadhop-settings.yaml' })[format];
