// Runtime validation of the network part of a deadhop service's operator
// API: relays, proxies and routing rules, relay health and history, the
// privacy audit. Objects are strict, so a response with unexpected fields is
// rejected rather than rendered.
import { z } from 'zod';
import { text, unixTime } from '@deadhop/client/schemas';

export const count = z.number().int().min(0);
export const shortText = z.string().max(500);

export const RelayStateSchema = z.strictObject({
  url: z.string().max(200),
  status: z.string().max(40),
  connected: z.boolean(),
  /** The keys (by id) that use this relay. */
  keys: z.array(z.string().max(40)).max(8),
});
export type RelayState = z.infer<typeof RelayStateSchema>;

export const RelayCheckSchema = z.strictObject({
  relay: z.string().max(200),
  ok: z.boolean(),
  code: z.string().max(40),
  reason: shortText,
  ms: count.nullable(),
});
export type RelayCheck = z.infer<typeof RelayCheckSchema>;

export const ProxyCheckSchema = z.strictObject({
  proxy: z.string().max(300),
  status: z.enum(['connected', 'partial', 'failed', 'direct']),
  checked_at: unixTime,
  relays: z.array(RelayCheckSchema).max(8),
});
export type ProxyCheck = z.infer<typeof ProxyCheckSchema>;

const registry = z.string().max(200);

/** An I2P name looked up through every registry, with which of them agree. */
export const I2pLookupSchema = z.strictObject({
  name: z.string().max(100),
  address: z.string().regex(/^[a-z2-7]{52}\.b32\.i2p$/),
  /** The first registry (in list order) that knew the name. */
  registry,
  agreeing: z.array(registry).max(4),
  disagreeing: z.array(z.strictObject({ registry, address: z.string().max(100) })).max(4),
  unknown: z.array(registry).max(4),
  unreachable: z.array(registry).max(4),
});
export type I2pLookup = z.infer<typeof I2pLookupSchema>;

/** One relay's end-to-end check: connects, carries ContextVM events, not rate-limiting. */
export const RelayHealthSchema = z.strictObject({
  relay: z.string().max(200),
  status: z.enum(['ok', 'degraded', 'down']),
  connects: z.boolean(),
  forwards: z.boolean().nullable(),
  rate_limited: z.boolean(),
  ms: count.nullable(),
  detail: shortText,
  checked_at: unixTime,
});
export type RelayHealth = z.infer<typeof RelayHealthSchema>;

export const RelayHealthReportSchema = z.strictObject({ relays: z.array(RelayHealthSchema).max(8) });
export type RelayHealthReport = z.infer<typeof RelayHealthReportSchema>;

export const RelayPointSchema = z.strictObject({ start: unixTime, ok: count, fail: count });
export type RelayPoint = z.infer<typeof RelayPointSchema>;

export const RelayStatsSchema = z.strictObject({
  relay: z.string().max(200),
  checks: count,
  check_failures: count,
  sends: count,
  send_failures: count,
  avg_ms: count.nullable(),
  points: z.array(RelayPointSchema).max(60),
});
export type RelayStats = z.infer<typeof RelayStatsSchema>;

export const RelayHistorySchema = z.strictObject({
  window: z.enum(['15m', '1h', '12h', '1d', '1w']),
  bucket_secs: count,
  since: unixTime,
  until: unixTime,
  relays: z.array(RelayStatsSchema).max(40),
});
export type RelayHistory = z.infer<typeof RelayHistorySchema>;

export const PrivacyCheckSchema = z.strictObject({
  id: z.string().max(40),
  area: z.enum(['network', 'ports', 'exposure']),
  title: shortText,
  result: z.enum(['pass', 'to_fix', 'fail', 'note', 'not_checked']),
  points: count.max(100),
  summary: shortText,
  evidence: z.array(shortText).max(20),
  fix: shortText.nullable(),
});
export type PrivacyCheck = z.infer<typeof PrivacyCheckSchema>;

export const PrivacyAuditSchema = z.strictObject({
  score: count.max(100),
  checked: count,
  total: count,
  ran_at: unixTime,
  checks: z.array(PrivacyCheckSchema).max(40),
});
export type PrivacyAudit = z.infer<typeof PrivacyAuditSchema>;

export const OfflinePolicySchema = z.enum(['kill_switch', 'admin_only', 'invoicing_only', 'open']);
export type OfflinePolicy = z.infer<typeof OfflinePolicySchema>;

/** Key ids a relay or rule is assigned to; empty means every key. */
export const keyIds = z.array(z.string().max(40)).max(8);

/** A proxy or group id: lower-case letters, digits, `-` and `_`. */
export const idSchema = z.string().min(1).max(24);

export const ProxyEntrySchema = z.strictObject({
  id: idSchema,
  name: text(60),
  url: z.string().max(300),
  /** An I2P router's HTTP proxy, the one I2P names are looked up through (at most one). Left out is no. */
  i2p: z.boolean().optional(),
});
export type ProxyEntry = z.infer<typeof ProxyEntrySchema>;

/** How a group picks its proxy. */
export const StrategySchema = z.enum(['failover', 'round_robin', 'chaos']);
export type Strategy = z.infer<typeof StrategySchema>;

/** Two or more proxies, in order, and how one of them is picked. */
export const ProxyGroupSchema = z.strictObject({
  id: idSchema,
  name: text(60),
  /** Proxy ids, in order, each once. */
  proxies: z.array(idSchema).max(8),
  strategy: StrategySchema,
  rotate_secs: count,
  chaos_min_secs: count,
  chaos_max_secs: count,
});
export type ProxyGroup = z.infer<typeof ProxyGroupSchema>;

/** Where relays go: straight, nowhere, through one proxy, or through a group. */
export const DestinationSchema = z.union([z.enum(['direct', 'block']), z.strictObject({ proxy: idSchema }), z.strictObject({ group: idSchema })]);
export type Destination = z.infer<typeof DestinationSchema>;

/** What a rule does while its proxy or group has nothing reachable. */
export const FallbackSchema = z.union([z.enum(['offline', 'policy']), z.strictObject({ to: DestinationSchema })]);
export type Fallback = z.infer<typeof FallbackSchema>;

/** One routing rule. The first rule that applies to a key and matches a relay decides its route. */
export const RuleSchema = z.strictObject({
  name: text(60),
  /** Relay addresses (`wss://…`) or host patterns (`*.onion`, `relay*.example:7777`). */
  match: z.array(z.string().max(256)).min(1).max(16),
  /** Keys the rule applies to; empty is every key. */
  keys: keyIds,
  to: DestinationSchema,
  /** For a rule through a proxy or group: what to do while it has nothing reachable. */
  fallback: FallbackSchema,
});
export type Rule = z.infer<typeof RuleSchema>;

export const ProxySettingsSchema = z.strictObject({
  list: z.array(ProxyEntrySchema).max(8),
  groups: z.array(ProxyGroupSchema).max(8),
  /** The default route: where relays that no rule matches go ("Everything else"). */
  default: DestinationSchema,
  /** Per-key default routes, by key id, instead of `default`. */
  default_keys: z.record(z.string().max(40), DestinationSchema),
  offline: OfflinePolicySchema,
  transparent: z.boolean(),
  rules: z.array(RuleSchema).max(32),
  /** Where I2P names are looked up: `http://…i2p/…{name}…` addresses; empty turns lookups off. */
  i2p_registries: z.array(z.string().max(200)).max(4),
});
export type ProxySettings = z.infer<typeof ProxySettingsSchema>;

/** Why a relay goes the way it does (from the service). */
export const RouteReasonSchema = z.enum(['rule', 'default', 'fallback', 'proxy_down', 'blocked', 'pool_offline', 'never_direct', 'transparent']);
export type RouteReason = z.infer<typeof RouteReasonSchema>;

/** The state of a default route or a group: what it goes through now. */
export const PoolStateSchema = z.enum(['transparent', 'direct', 'active', 'suspended', 'offline', 'blocked']);
export type PoolState = z.infer<typeof PoolStateSchema>;

/** One group as one key uses it. */
export const GroupHealthSchema = z.strictObject({
  group: idSchema,
  state: PoolStateSchema,
  /** The proxy it uses now. */
  active: idSchema.nullable(),
  reachable: count,
  next_switch_at: unixTime.nullable(),
});
export type GroupHealth = z.infer<typeof GroupHealthSchema>;

export const ProxyPoolSchema = z.strictObject({
  state: PoolStateSchema,
  posture: z.enum(['normal', 'off', 'admin_only', 'invoicing_only', 'open']),
  /** The default route (of the public invoices key). */
  default: DestinationSchema,
  offline: OfflinePolicySchema,
  transparent: z.boolean(),
  active: idSchema.nullable(),
  reachable: count,
  total: count,
  /** The soonest switch of any group a key uses. */
  next_switch_at: unixTime.nullable(),
  proxies: z
    .array(
      z.strictObject({
        id: idSchema,
        name: text(60),
        url: z.string().max(300),
        reachable: z.boolean().nullable(),
        checked_at: unixTime.nullable(),
        status: z.string().max(20).nullable(),
        reason: z.string().max(300).nullable(),
      }),
    )
    .max(8),
  /** Each key's default route and groups; the fields above are the public invoices key's. */
  lanes: z
    .array(
      z.strictObject({
        key: z.string().max(40),
        /** This key's default route. */
        default: DestinationSchema,
        state: PoolStateSchema,
        active: idSchema.nullable(),
        reachable: count,
        next_switch_at: unixTime.nullable(),
        /** Whether some relay of this key matches no rule (takes the default route). */
        uses_default: z.boolean(),
        /** The groups this key may use, and what each uses now. */
        groups: z.array(GroupHealthSchema).max(8),
      }),
    )
    .max(8),
  /** Where every relay of every key goes now, as the service decided. */
  routes: z
    .array(
      z.strictObject({
        key: z.string().max(40),
        relay: z.string().max(300),
        /** Number (from 1) of the rule that matched; null: the default route. */
        rule: z.number().int().min(1).max(32).nullable(),
        via: z.enum(['proxy', 'direct', 'off']),
        proxy: idSchema.nullable(),
        reason: RouteReasonSchema,
      }),
    )
    .max(64),
});
export type ProxyPool = z.infer<typeof ProxyPoolSchema>;
export type RouteState = ProxyPool['routes'][number];
export type LaneState = ProxyPool['lanes'][number];

/** One of the service's keys and what it is for. */
export const KeyInfoSchema = z.strictObject({
  id: z.string().min(1).max(40),
  label: text(60),
  pubkey: z.string().max(64),
  tools: z.array(z.string().max(40)).max(40),
  operators_only: z.boolean(),
  relays: z.array(z.string().max(200)).max(8),
});
export type KeyInfo = z.infer<typeof KeyInfoSchema>;


/** The network part of a service's settings. */
export type NetworkSettings = {
  relays: string[];
  relay_keys: Record<string, string[]>;
  relay_names: Record<string, string>;
  proxies: ProxySettings;
};

/** The parts of a service's health the network views read. */
export type NetworkHealth = {
  keys: KeyInfo[];
  relays: RelayState[];
  relay_health: RelayHealth[];
  proxy_pool: ProxyPool;
};
