// Fixtures shared by the unit tests.
import type { I2pLookup, KeyInfo, NetworkHealth, NetworkSettings, PrivacyAudit, ProxyCheck, ProxyPool, RelayHistory, RelayStats } from './lib/schemas';
export const ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080';
export const PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
export const ADMIN_PUBKEY = 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
export const SERVICE_PUBKEY = '5b9b8ef38c43187d1daa80cc14d0c0f0107d480a3be7b75dcf6c4e7d08bd2408';
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
  return { state: 'direct', posture: 'normal', mode: 'failover', offline: 'kill_switch', transparent: false, active: null, reachable: 0, total: 0, next_switch_at: null, proxies: [], lanes: [], routes: [], ...over };
}

/** One proxy in use, as the service reports it. */
export function activePool(over: Partial<ProxyPool> = {}): ProxyPool {
  return proxyPool({
    state: 'active',
    active: 'p1',
    reachable: 1,
    total: 1,
    proxies: [{ id: 'p1', name: '', url: 'socks5://127.0.0.1:9050', reachable: true, checked_at: 1_700_000_050, status: 'connected', reason: null, keys: [], pool: true }],
    ...over,
  });
}

export function relayStats(over: Partial<RelayStats> = {}): RelayStats {
  const points = [0, 1, 2, 3].map((i) => ({ start: 1_700_000_000 + i * 3600, ok: i === 1 ? 0 : 4, fail: i === 1 ? 2 : 0 }));
  return { relay: 'ws://127.0.0.1:7777', checks: 4, check_failures: 0, sends: 10, send_failures: 2, avg_ms: 120, points, ...over };
}

export function relayHistory(over: Partial<RelayHistory> = {}): RelayHistory {
  return { window: '1d', bucket_secs: 3600, since: 1_700_000_000, until: 1_700_014_400, relays: [relayStats()], ...over };
}

/** The network part of a service's health. */
export function health(over: Partial<NetworkHealth> = {}): NetworkHealth {
  return {
    keys: keyInfos(),
    relays: [{ url: 'ws://127.0.0.1:7777', status: 'connected', connected: true, keys: ['admin', 'invoices'] }],
    proxy_pool: proxyPool(),
    relay_health: [],
    ...over,
  };
}

/** The network part of a service's settings. */
export function settings(over: Partial<NetworkSettings> = {}): NetworkSettings {
  return {
    relays: ['ws://127.0.0.1:7777'],
    relay_keys: {},
    relay_names: {},
    proxies: { list: [], mode: 'failover', rotate_secs: 3600, chaos_min_secs: 300, chaos_max_secs: 900, offline: 'kill_switch', transparent: false, rules: [], i2p_registries: [...REGISTRIES] },
    ...over,
  };
}

/** What the views read of a service's settings view. */
export function settingsView(over: Record<string, unknown> = {}) {
  return {
    settings: settings(),
    defaults: settings(),
    fixed: { network: 'regtest', keys: keyInfos(), proxy_locked: false },
    ...over,
  };
}
