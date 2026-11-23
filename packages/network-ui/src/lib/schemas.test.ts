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
  RouteToSchema,
  RuleSchema,
} from './schemas';
import { activePool, health, i2pLookup, keyInfos, privacyAudit, proxyCheck, proxyPool, relayHistory, relayStats, settings } from '../test-helpers';

const NOW = 1_763_900_000;

describe('network schemas', () => {
  it('accept what the service sends', () => {
    expect(I2pLookupSchema.parse(i2pLookup())).toEqual(i2pLookup());
    for (const k of keyInfos()) expect(KeyInfoSchema.parse(k)).toEqual(k);
    expect(ProxyCheckSchema.parse(proxyCheck())).toEqual(proxyCheck());
    expect(PrivacyAuditSchema.parse(privacyAudit())).toEqual(privacyAudit());
    expect(ProxyPoolSchema.parse(proxyPool())).toEqual(proxyPool());
    expect(ProxyPoolSchema.parse(activePool())).toEqual(activePool());
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
        { id: 't', name: 'tor', url: 'socks5://127.0.0.1:9050', keys: [], pool: true },
        { id: 'r', name: 'i2pd', url: 'http://127.0.0.1:4444', keys: ['admin'], pool: false, i2p: true },
      ],
      rules: [
        { name: 'I2P', match: ['*.i2p'], keys: [], to: { proxy: 'r' }, fallback: 'offline' },
        { name: 'local', match: ['127.0.0.1'], keys: ['admin'], to: 'direct', fallback: 'pool' },
      ],
    };
    expect(ProxySettingsSchema.parse(proxies)).toEqual(proxies);
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
    expect(RouteToSchema.safeParse({ proxy: '' }).success).toBe(false);
    expect(RouteToSchema.safeParse('tunnel').success).toBe(false);
    expect(RuleSchema.safeParse({ name: '', match: [], keys: [], to: 'pool', fallback: 'offline' }).success).toBe(false);
  });
});
