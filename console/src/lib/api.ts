// Typed client for the network tools of a deadhop service, for the console.
// The connection comes from @deadhop/client; every response is validated
// before any of it reaches the UI.
import { ApiError, CONNECT_TIMEOUT_MS, PayApi, connect as connectService, type NostrSigner, type ServiceConfig, type ServiceInfo } from '@deadhop/client';
import type { NetworkApi, ProxiesPatch } from '@deadhop/network-ui/lib/network-api';
import {
  I2pLookupSchema,
  NetworkHealthSchema,
  NetworkViewSchema,
  PrivacyAuditSchema,
  ProxyCheckSchema,
  RelayHealthReportSchema,
  RelayHistorySchema,
  type I2pLookup,
  type NetworkSettings,
  type NetworkView,
  type PrivacyAudit,
  type ProxyCheck,
  type RelayHealthReport,
  type RelayHistory,
} from './schemas';
import type { NetworkHealth } from '@deadhop/network-ui/lib/network-api';

export { ApiError, CONNECT_TIMEOUT_MS };

/** How long an I2P name lookup may take: the service gives registries 90 seconds. */
export const LOOKUP_TIMEOUT_MS = 120_000;

/** Network settings to change; anything left out stays as it is. */
export interface NetworkPatch {
  relays?: string[];
  relay_keys?: NetworkSettings['relay_keys'];
  relay_names?: NetworkSettings['relay_names'];
  proxies?: ProxiesPatch;
}

/** The network tools. `call` (from the client) validates every answer. */
export class ConsoleApi extends PayApi implements NetworkApi {
  getNetwork(): Promise<NetworkView> {
    return this.call('get_network', {}, NetworkViewSchema);
  }

  updateNetwork(patch: NetworkPatch): Promise<NetworkView> {
    return this.call('update_network', { patch }, NetworkViewSchema);
  }

  getHealth(): Promise<NetworkHealth> {
    return this.call('get_health', {}, NetworkHealthSchema);
  }

  /** Test a proxy: a listed one by `id`, an address, or (no argument) the one in use. */
  checkProxy(target?: string | { id: string }): Promise<ProxyCheck> {
    const params = target === undefined ? {} : typeof target === 'string' ? { proxy: target } : { id: target.id };
    return this.call('check_proxy', params, ProxyCheckSchema);
  }

  /** Look up an I2P name through the I2P router proxy; up to a minute and a half. */
  resolveI2pName(name: string): Promise<I2pLookup> {
    return this.call('resolve_i2p_name', { name }, I2pLookupSchema, LOOKUP_TIMEOUT_MS);
  }

  checkRelays(): Promise<RelayHealthReport> {
    return this.call('check_relays', {}, RelayHealthReportSchema);
  }

  getRelayHistory(window: RelayHistory['window'] = '1h'): Promise<RelayHistory> {
    return this.call('get_relay_history', { window }, RelayHistorySchema);
  }

  getPrivacyAudit(): Promise<PrivacyAudit> {
    return this.call('get_privacy_audit', {}, PrivacyAuditSchema);
  }
}

export interface Session {
  api: ConsoleApi;
  /** Hex public key of the signed-in identity. */
  pubkey: string;
  info: ServiceInfo;
  close(): Promise<void>;
}

/** Sign in to the service's administration key. Only its operators get through. */
export async function connect(signer: NostrSigner, target: ServiceConfig, timeoutMs = CONNECT_TIMEOUT_MS, open = connectService): Promise<Session> {
  const session = await open(signer, target, { timeoutMs, clientName: 'deadhop-console' });
  if (!session.info.is_admin) {
    await session.close().catch(() => undefined);
    throw new ApiError('unauthorized');
  }
  return { api: new ConsoleApi(session.callTool), pubkey: session.pubkey, info: session.info, close: session.close };
}
