// Fixtures shared by the unit tests.
import { createBase58check } from '@scure/base';
import { sha256 } from '@noble/hashes/sha2.js';
import type { SetupStatus } from './lib/setup';
import type { InvoiceKeyInfo, InvoiceKeyList, KeyTotals } from './lib/schemas';
import type { AdminInvoice, I2pLookup, AuditLog, Health, Info, KeyInfo, Invoice, Metrics, PrivacyAudit, ProxyCheck, ProxyPool, RelayHistory, RelayStats, Series, Settings, SettingsView, Stats } from './lib/schemas';

export const ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
export const PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
export const ADMIN_PUBKEY = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
export const SERVICE_PUBKEY = '5b9b8ef38c43187d1daa80cc14d0c0f0107d480a3be7b75dcf6c4e7d08bd2408';

/** The service's default I2P name registries. */
export const REGISTRIES = ['http://notbob.i2p/cgi-bin/jump.cgi?q={name}', 'http://stats.i2p/cgi-bin/jump.cgi?a={name}'];
export const B32 = 'nostrsrpr4c7lrswidgws2dzx5yrllqujdewru34jfydjjqplapq.b32.i2p';

/** An I2P name lookup: notbob.i2p knows it, stats.i2p does not. */
export function i2pLookup(over: Partial<I2pLookup> = {}): I2pLookup {
  return { name: 'nostr-not.i2p', address: B32, registry: REGISTRIES[0], agreeing: [REGISTRIES[0]], disagreeing: [], unknown: [REGISTRIES[1]], unreachable: [], ...over };
}

/** The service's two keys, as it reports them. */
export function keyInfos(relays: string[] = ['ws://127.0.0.1:7777']): KeyInfo[] {
  return [
    { id: 'invoices', label: 'Public invoices', pubkey: SERVICE_PUBKEY, tools: ['get_info', 'create_invoice', 'get_invoice'], operators_only: false, relays },
    { id: 'admin', label: 'Administration', pubkey: ADMIN_PUBKEY, tools: ['*'], operators_only: true, relays },
  ];
}

export function invoice(over: Partial<Invoice> = {}): Invoice {
  const base: Invoice = {
    id: '0123456789abcdef0123456789abcdef',
    address: ADDRESS,
    amount_sat: 50_000,
    memo: 'table 4',
    status: 'pending',
    received_sat: 0,
    confirmed_sat: 0,
    created_at: 1_700_000_000,
    expires_at: 1_700_003_600,
    settled_at: null,
    bip21: `bitcoin:${ADDRESS}?amount=0.00050000`,
    confirmations_required: 1,
  };
  return { ...base, ...over };
}

export function adminInvoice(over: Partial<AdminInvoice> = {}): AdminInvoice {
  return { ...invoice(), index: 0, creator: PUBKEY, ...over };
}

export function info(over: Partial<Info> = {}): Info {
  return {
    name: 'deadhop',
    version: '0.1.0',
    network: 'regtest',
    public_invoicing: true,
    pow_bits: 4,
    pow_window_secs: 600,
    min_confirmations: 1,
    default_expiry_secs: 3600,
    max_expiry_secs: 86400,
    min_amount_sat: 1000,
    max_amount_sat: 100_000_000,
    is_admin: false,
    ...over,
  };
}

export function stats(over: Partial<Stats> = {}): Stats {
  return {
    pending: 2,
    detected: 1,
    confirmed: 3,
    expired: 4,
    confirmed_sat: 150_000,
    detected_sat: 50_000,
    next_index: 10,
    tip_height: 101,
    last_poll_at: 1_700_000_100,
    chain_ok: true,
    watch_errors: 0,
    ...over,
  };
}

/** Wrap a value the way an MCP tool result carries it. */
export function toolResult(structuredContent: unknown) {
  return { content: [], structuredContent, isError: false };
}

export function proxyCheck(over: Partial<ProxyCheck> = {}): ProxyCheck {
  return {
    proxy: 'socks5://127.0.0.1:9050',
    status: 'connected',
    checked_at: 1_700_000_050,
    relays: [{ relay: 'ws://127.0.0.1:7777', ok: true, code: 'SOCKS5 00', reason: 'Reached through the proxy.', ms: 84 }],
    ...over,
  };
}

export function privacyAudit(over: Partial<PrivacyAudit> = {}): PrivacyAudit {
  return {
    score: 90,
    checked: 8,
    total: 10,
    ran_at: 1_700_000_060,
    checks: [
      { id: 'relays_via_proxy', area: 'network', title: 'Your IP is hidden from relays', result: 'pass', points: 0, summary: 'Relay connections go through the proxy.', evidence: ['proxy   socks5://127.0.0.1:9050'], fix: null },
      { id: 'proxy_locked', area: 'network', title: 'The proxy can be changed remotely', result: 'to_fix', points: 10, summary: 'A stolen operator key could set a proxy it controls.', evidence: ['DEADHOP_PROXY_LOCKED   false'], fix: 'Set DEADHOP_PROXY_LOCKED=true on the host.' },
      { id: 'host_ports', area: 'ports', title: "The host's open ports", result: 'not_checked', points: 0, summary: 'The service sees only its own network namespace.', evidence: [], fix: 'On the host, list them with `ss -tlnp`.' },
      { id: 'announce', area: 'exposure', title: 'No public announcements', result: 'pass', points: 0, summary: 'The service publishes no discovery events.', evidence: ['DEADHOP_ANNOUNCE   false'], fix: null },
    ],
    ...over,
  };
}

export function proxyPool(over: Partial<ProxyPool> = {}): ProxyPool {
  return { state: 'direct', posture: 'normal', default: 'direct', offline: 'kill_switch', transparent: false, active: null, reachable: 0, total: 0, next_switch_at: null, proxies: [], lanes: [], routes: [], ...over };
}

/** One proxy in use, as the service reports it. */
export function activePool(over: Partial<ProxyPool> = {}): ProxyPool {
  return proxyPool({
    state: 'active',
    default: { proxy: 'p1' },
    active: 'p1',
    reachable: 1,
    total: 1,
    proxies: [{ id: 'p1', name: '', url: 'socks5://127.0.0.1:9050', reachable: true, checked_at: 1_700_000_050, status: 'connected', reason: null }],
    ...over,
  });
}

export function health(over: Partial<Health> = {}): Health {
  return {
    service: { version: '0.1.0', started_at: 1_700_000_000, uptime_secs: 3_700, online_since: 1_699_000_000, paused: false, restarts: 0, restart_pending: false },
    keys: keyInfos(),
    relays: [{ url: 'ws://127.0.0.1:7777', status: 'connected', connected: true, keys: ['admin', 'invoices'] }],
    proxy: '',
    proxy_check: null,
    proxy_pool: proxyPool(),
    relay_health: [],
    chain: { ok: true, tip_height: 101, last_poll_at: 1_700_000_100, poll_secs: 10, watch_errors: 0, backend_local: true, transport: 'tcp' },
    database: { ok: true, size_bytes: 2048, invoices: 10, backups: 0, last_backup_at: null },
    warnings: [],
    ...over,
  };
}

export function metrics(over: Partial<Metrics> = {}): Metrics {
  return {
    now: 1_700_000_000,
    online_since: 1_699_000_000,
    addresses_created: 12,
    invoices: 10,
    payments: 3,
    received_sat: 150_000,
    windows: [
      { label: '24h', secs: 86_400, available: true, count: 1, sat: 50_000 },
      { label: '7d', secs: 604_800, available: true, count: 2, sat: 100_000 },
      { label: '30d', secs: 2_592_000, available: false, count: 3, sat: 150_000 },
      { label: '365d', secs: 31_536_000, available: false, count: 3, sat: 150_000 },
    ],
    sweep: { enabled: false, mode: 'payjoin', threshold_sat: 1_000_000, received_sat: 150_000, due: false },
    ...over,
  };
}

export function series(over: Partial<Series> = {}): Series {
  const points = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ start: 1_699_400_000 + i * 86_400, count: i === 5 ? 2 : 0, sat: i === 5 ? 100_000 : 0 }));
  return { range: 'week', bucket_secs: 86_400, online_since: 1_699_500_000, points, ...over };
}

export function settings(over: Partial<Settings> = {}): Settings {
  return {
    name: 'deadhop',
    relays: ['ws://127.0.0.1:7777'],
    relay_keys: {},
    relay_names: {},
    public_invoicing: true,
    pow_bits: 16,
    pow_window_secs: 600,
    min_confirmations: 1,
    default_expiry_secs: 3600,
    max_expiry_secs: 86_400,
    min_amount_sat: 1000,
    max_amount_sat: 100_000_000,
    max_open_invoices: 500,
    max_invoices_per_day: 2000,
    rate_global_per_min: 30,
    rate_per_key_per_min: 6,
    rate_requests_per_min: 1200,
    rate_requests_per_key_per_min: 120,
    poll_secs: 10,
    late_grace_secs: 86_400,
    proxies: { list: [], groups: [], default: 'direct', default_keys: {}, offline: 'kill_switch', transparent: false, rules: [], i2p_registries: [...REGISTRIES] },
    sweep: { enabled: false, mode: 'payjoin', threshold_sat: 1_000_000, max_fee_rate_sat_vb: 20, min_anonymity_set: 5 },
    ...over,
  };
}

export function settingsView(over: Partial<SettingsView> = {}): SettingsView {
  return {
    settings: settings(),
    defaults: settings(),
    overridden: [],
    fixed: { network: 'regtest', electrum: '127.0.0.1:50001', electrum_transport: 'tcp', first_address: ADDRESS, announce: false, keys: keyInfos(), proxy_locked: false },
    operators: [{ pubkey: PUBKEY, label: '', source: 'environment', added_at: null }],
    restart_pending: false,
    warnings: [],
    ...over,
  };
}

export function audit(over: Partial<AuditLog> = {}): AuditLog {
  return {
    entries: [
      { at: 1_700_000_000, actor: PUBKEY, action: 'update_settings', detail: '{"pow_bits":18}' },
      { at: 1_699_999_000, actor: 'service', action: 'revert_connection', detail: 'no relay connected' },
    ],
    ...over,
  };
}

export function relayStats(over: Partial<RelayStats> = {}): RelayStats {
  const points = [0, 1, 2, 3].map((i) => ({ start: 1_700_000_000 + i * 3600, ok: i === 1 ? 0 : 4, fail: i === 1 ? 2 : 0 }));
  return { relay: 'ws://127.0.0.1:7777', checks: 4, check_failures: 0, sends: 10, send_failures: 2, avg_ms: 120, points, ...over };
}

export function relayHistory(over: Partial<RelayHistory> = {}): RelayHistory {
  return { window: '1d', bucket_secs: 3600, since: 1_700_000_000, until: 1_700_014_400, relays: [relayStats()], ...over };
}

// ---- Invoice keys (added for the invoice-keys views) ----

export const SHOP_PUBKEY = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';

/** An invoice key with its totals; the original one unless told otherwise. */
export function invoiceKey(over: Partial<InvoiceKeyInfo> = {}, totals: Partial<KeyTotals> = {}): InvoiceKeyInfo {
  const id = over.id ?? 'invoices';
  return {
    id,
    label: 'Public invoices',
    description: '',
    color: 0,
    name: '',
    public_invoicing: true,
    announce: false,
    created_at: 1_699_000_000,
    created_by: '',
    archived_at: null,
    pubkey: SERVICE_PUBKEY,
    original: id === 'invoices',
    relays: ['ws://127.0.0.1:7777'],
    ...over,
    totals: { key: id, pending: 2, detected: 1, confirmed: 3, expired: 4, confirmed_sat: 150_000, detected_sat: 50_000, last_paid_at: 1_700_000_000, ...totals },
  };
}

/** An added key, `shop` ("Shop"), in colour 1. */
export function shopKey(over: Partial<InvoiceKeyInfo> = {}, totals: Partial<KeyTotals> = {}): InvoiceKeyInfo {
  return invoiceKey(
    { id: 'shop', label: 'Shop', description: 'Shop checkout', color: 1, created_by: PUBKEY, created_at: 1_699_500_000, pubkey: SHOP_PUBKEY, ...over },
    { pending: 1, detected: 0, confirmed: 1, expired: 0, confirmed_sat: 50_000, detected_sat: 0, ...totals },
  );
}

export function invoiceKeyList(keys: InvoiceKeyInfo[] = [invoiceKey()], over: Partial<InvoiceKeyList> = {}): InvoiceKeyList {
  return { keys, max_keys: 7, since: 0, ...over };
}

/** The service's keys with `shop` added, as health and settings report them. */
export function keyInfosWithShop(relays: string[] = ['ws://127.0.0.1:7777']): KeyInfo[] {
  const [invoices, admin] = keyInfos(relays);
  return [invoices, { id: 'shop', label: 'Shop', pubkey: SHOP_PUBKEY, tools: ['get_info', 'create_invoice', 'get_invoice'], operators_only: false, relays }, admin];
}

// ---- Setup mode ----

// BIP-84's test vector: its first receive address is known.
export const ZPUB = 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs';
export const XPUB = 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';
export const TPUB = 'tpubD6NzVbkrYhZ4XgiXtGrdW5XDAPFCL9h7we1vwNCpn8tGbBcgfVYjXyhWo4E1xkh56hjod1RhGjxbaTLV3X4FyWuejifB9jusQ46QzG87VKp';
export const b58 = createBase58check(sha256);
export const withVersion = (key: string, version: number) => {
  const raw = b58.decode(key);
  new DataView(raw.buffer, raw.byteOffset).setUint32(0, version);
  return b58.encode(raw);
};

export const STATUS: SetupStatus = {
  version: 1,
  network: 'bitcoin',
  settings: [
    { name: 'DEADHOP_ELECTRUM', state: 'missing', about: 'where to watch the chain' },
    { name: 'DEADHOP_ADMINS', state: 'missing', about: 'who may operate it' },
    { name: 'DEADHOP_XPUB', state: 'found', about: 'the account key payments go to' },
    { name: 'DEADHOP_RELAYS', state: 'found', about: 'the relays it is reached through' },
    { name: 'DEADHOP_NETWORK', state: 'default', about: 'the bitcoin network' },
  ],
};

