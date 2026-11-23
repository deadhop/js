// What the network views need from a service: the network tools and the
// network part of its health. A service's own API client satisfies this as it
// is (the dashboard's PayApi does), so the views work for any deadhop service
// that serves the network tools.
import type { Health, PrivacyAudit, ProxyCheck, RelayHealthReport, RelayHistory } from './schemas';

/** The parts of `get_health` the network views read. */
export type NetworkHealth = Pick<Health, 'keys' | 'relays' | 'relay_health' | 'proxy_pool'>;

export interface NetworkApi {
  checkProxy(target?: string | { id: string }): Promise<ProxyCheck>;
  checkRelays(): Promise<RelayHealthReport>;
  getRelayHistory(window?: RelayHistory['window']): Promise<RelayHistory>;
  getPrivacyAudit(): Promise<PrivacyAudit>;
  getHealth(): Promise<NetworkHealth>;
}
