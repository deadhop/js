// What the network views need from a service: the network tools and the
// network part of its health. A service's own API client satisfies this as it
// is (the dashboard's PayApi does), so the views work for any deadhop service
// that serves the network tools.
import type { I2pLookup, NetworkHealth, PrivacyAudit, ProxyCheck, ProxySettings, RelayHealthReport, RelayHistory } from './schemas';

export type { NetworkHealth };


export interface NetworkApi {
  checkProxy(target?: string | { id: string }): Promise<ProxyCheck>;
  checkRelays(): Promise<RelayHealthReport>;
  getRelayHistory(window?: RelayHistory['window']): Promise<RelayHistory>;
  getPrivacyAudit(): Promise<PrivacyAudit>;
  getHealth(): Promise<NetworkHealth>;
  resolveI2pName(name: string): Promise<I2pLookup>;
}

/** A proxy as sent: no `id` makes a new one; a hidden password stays with its `id`. */
export interface ProxyInput {
  id?: string;
  name?: string;
  url: string;
  /** Key ids whose default route may use it; empty or left out is every key. */
  keys?: string[];
  /** In the default route; left out is yes. */
  pool?: boolean;
  /** An I2P router's HTTP proxy; left out is no. */
  i2p?: boolean;
}

/** Changes to the proxy settings; `list` replaces the whole list. */
export interface ProxiesPatch extends Partial<Omit<ProxySettings, 'list'>> {
  list?: ProxyInput[];
}
