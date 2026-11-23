// Runtime validation of what the console reads from a service: the network
// view (`get_network` / `update_network`) and the network part of its health.
import { z } from 'zod';
import { text } from '@deadhop/client/schemas';
import {
  KeyInfoSchema,
  ProxyPoolSchema,
  ProxySettingsSchema,
  RelayHealthSchema,
  RelayStateSchema,
  keyIds,
  shortText,
  type NetworkHealth,
  type NetworkSettings,
} from '@deadhop/network-ui/schemas';

export * from '@deadhop/network-ui/schemas';

export const NetworkSettingsSchema = z.strictObject({
  relays: z.array(z.string().max(200)).min(1).max(8),
  /** Relays only some keys use (relay address to key ids); the rest serve every key. */
  relay_keys: z.record(z.string().max(200), keyIds),
  /** Names shown for relays (relay address to name). */
  relay_names: z.record(z.string().max(200), text(60)),
  proxies: ProxySettingsSchema,
});

/** What `get_network` and `update_network` answer. */
export const NetworkViewSchema = z.strictObject({
  settings: NetworkSettingsSchema,
  defaults: NetworkSettingsSchema,
  overridden: z.array(z.string().max(60)).max(10),
  /** The bitcoin network: on `bitcoin` a relay needs TLS unless it is local or on an overlay network. */
  chain: z.string().max(20),
  keys: z.array(KeyInfoSchema).max(8),
  proxy_locked: z.boolean(),
  restart_pending: z.boolean(),
  warnings: z.array(shortText).max(20),
});
export type NetworkView = z.infer<typeof NetworkViewSchema>;

/**
 * The network part of `get_health`. Every service reports more than this (its
 * chain, database and so on, which differ between services), so only these
 * fields are read and checked; the rest is dropped, never rendered.
 */
export const NetworkHealthSchema = z.object({
  keys: z.array(KeyInfoSchema).max(8),
  relays: z.array(RelayStateSchema).max(8),
  relay_health: z.array(RelayHealthSchema).max(8),
  proxy_pool: ProxyPoolSchema,
});

// The schemas above produce the shapes the network views take (checked when type-checking).
type Fits<A, B> = A extends B ? true : never;
export type SchemasFit = [Fits<z.infer<typeof NetworkSettingsSchema>, NetworkSettings>, Fits<z.infer<typeof NetworkHealthSchema>, NetworkHealth>];
