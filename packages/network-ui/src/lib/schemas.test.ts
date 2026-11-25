import { describe, expect, it } from 'vitest';
import {
  I2pLookupSchema,
  KeyInfoSchema,
  PrivacyAuditSchema,
  ProxyCheckSchema,
  ProxyPoolSchema,
  ProxySettingsSchema,
  RelayHealthReportSchema,
  RelayHistorySchema,
  RelayStateSchema,
  RelayStatsSchema,
  DestinationSchema,
  FallbackSchema,
  ProxyGroupSchema,
  RuleSchema,
} from './schemas';
import { activePool, group, health, i2pLookup, keyInfos, lane, privacyAudit, proxyCheck, proxyPool, relayHistory, relayStats, settings } from '../test-helpers';
// What the service sends, as its own snapshot tests record it.
import poolHealth from '../../../../server/tests/snapshots/pool_health.json';
import fullSettings from '../../../../server/tests/snapshots/get_settings_full.json';

const NOW = 1_763_900_000;

describe('network schemas', () => {
  it('accept what the service sends', () => {
    expect(I2pLookupSchema.parse(i2pLookup())).toEqual(i2pLookup());
    for (const k of keyInfos()) expect(KeyInfoSchema.parse(k)).toEqual(k);
    expect(ProxyCheckSchema.parse(proxyCheck())).toEqual(proxyCheck());
    expect(PrivacyAuditSchema.parse(privacyAudit())).toEqual(privacyAudit());
    expect(ProxyPoolSchema.parse(proxyPool())).toEqual(proxyPool());
    expect(ProxyPoolSchema.parse(activePool())).toEqual(activePool());
    const lanes = activePool({ lanes: [lane('admin', { groups: [{ group: 'g', state: 'suspended', active: 'p1', reachable: 1, next_switch_at: null }] })] });
    expect(ProxyPoolSchema.parse(lanes)).toEqual(lanes);
    expect(RelayStatsSchema.parse(relayStats())).toEqual(relayStats());
    expect(RelayHistorySchema.parse(relayHistory())).toEqual(relayHistory());
    for (const r of health().relays) expect(RelayStateSchema.parse(r)).toEqual(r);
    expect(ProxySettingsSchema.parse(settings().proxies)).toEqual(settings().proxies);
  });

  it('accept a relay health report and proxy settings with rules and an I2P router', () => {
    const report = {
      relays: [
        { relay: 'wss://relay.example', status: 'ok', connects: true, forwards: true, rate_limited: false, ms: 120, detail: '', checked_at: NOW },
        { relay: 'ws://127.0.0.1:7777', status: 'down', connects: false, forwards: null, rate_limited: false, ms: null, detail: 'connection refused', checked_at: NOW },
      ],
    };
    expect(RelayHealthReportSchema.parse(report)).toEqual(report);
    const proxies = {
      ...settings().proxies,
      list: [
        { id: 't', name: 'tor', url: 'socks5://127.0.0.1:9050' },
        { id: 'v', name: 'vpn', url: 'socks5://10.8.0.1:1080', i2p: false },
        { id: 'r', name: 'i2pd', url: 'http://127.0.0.1:4444', i2p: true },
      ],
      groups: [group('exits', ['t', 'v'])],
      default: { group: 'exits' },
      default_keys: { admin: { proxy: 't' } },
      rules: [
        { name: 'I2P', match: ['*.i2p'], keys: [], to: { proxy: 'r' }, fallback: 'offline' },
        { name: 'local', match: ['127.0.0.1'], keys: ['admin'], to: 'direct', fallback: 'policy' },
        { name: 'exit', match: ['*'], keys: [], to: { group: 'exits' }, fallback: { to: { proxy: 't' } } },
      ],
    };
    expect(ProxySettingsSchema.parse(proxies)).toEqual(proxies);
  });

  it("parse the service's own snapshots of the proxy settings and the proxy health", () => {
    for (const view of [fullSettings.defaults, fullSettings.settings]) expect(ProxySettingsSchema.parse(view.proxies)).toEqual(view.proxies);
    const cases = Object.entries(poolHealth).filter(([, v]) => !Array.isArray(v));
    expect(cases.length).toBeGreaterThanOrEqual(6);
    for (const [name, pool] of cases) expect(ProxyPoolSchema.safeParse(pool).success, name).toBe(true);
  });

  it('reject unexpected fields, bad values and out-of-range numbers', () => {
    expect(I2pLookupSchema.safeParse({ ...i2pLookup(), address: 'not-a-b32.i2p' }).success).toBe(false);
    expect(KeyInfoSchema.safeParse({ ...keyInfos()[0], secret: 'x' }).success).toBe(false);
    expect(KeyInfoSchema.safeParse({ ...keyInfos()[0], id: '' }).success).toBe(false);
    expect(ProxyCheckSchema.safeParse({ ...proxyCheck(), status: 'maybe' }).success).toBe(false);
    expect(PrivacyAuditSchema.safeParse({ ...privacyAudit(), score: 101 }).success).toBe(false);
    expect(RelayHistorySchema.safeParse({ ...relayHistory(), window: '2d' }).success).toBe(false);
    expect(RelayStatsSchema.safeParse({ ...relayStats(), checks: -1 }).success).toBe(false);
    expect(ProxyPoolSchema.safeParse({ ...proxyPool(), state: 'running' }).success).toBe(false);
    expect(ProxySettingsSchema.safeParse({ ...settings().proxies, i2p_registries: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
    expect(DestinationSchema.safeParse({ proxy: '' }).success).toBe(false);
    expect(DestinationSchema.safeParse({ proxy: 'a', group: 'b' }).success).toBe(false);
    expect(DestinationSchema.safeParse('pool').success).toBe(false);
    expect(FallbackSchema.safeParse('pool').success).toBe(false);
    expect(FallbackSchema.safeParse({ to: 'pool' }).success).toBe(false);
    expect(ProxyGroupSchema.safeParse({ ...group('g', ['a', 'b']), strategy: 'off' }).success).toBe(false);
    expect(RuleSchema.safeParse({ name: '', match: ['*'], keys: [], to: 'pool', fallback: 'offline' }).success).toBe(false);
    // The old shape is refused: a proxy with keys and pool, a strategy on the settings.
    expect(ProxySettingsSchema.safeParse({ ...settings().proxies, list: [{ id: 'a', name: '', url: 'socks5://h:1', keys: [], pool: true }] }).success).toBe(false);
    expect(ProxySettingsSchema.safeParse({ ...settings().proxies, mode: 'failover' }).success).toBe(false);
  });
});
