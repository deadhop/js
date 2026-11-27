// Typed client for the payment service, for the dashboard. The invoice calls
// and the connection come from @deadhop/client; the operator tools are added
// here. Every response is validated before any of it reaches the UI.
import type { NostrSigner } from '@contextvm/sdk';
import {
  ApiError,
  CONNECT_TIMEOUT_MS,
  PayApi as InvoiceApi,
  connect as connectService,
  localSigner,
  type MineOptions,
} from '@deadhop/client';
import type { ActivityListener, ToolCaller } from '@deadhop/client';
import {
  AuditLogSchema,
  BackupListSchema,
  BackupSchema,
  ControlResultSchema,
  HealthSchema,
  InvoiceKeyListSchema,
  InvoiceListSchema,
  MetricsSchema,
  SeriesSchema,
  SettingsViewSchema,
  StatsSchema,
  WipeResultSchema,
  type AuditLog,
  type Backup,
  type BackupList,
  type Config,
  type ControlResult,
  type Health,
  type Info,
  type Invoice,
  type InvoiceKeyList,
  type InvoiceList,
  type Metrics,
  type Range,
  type Series,
  type Settings,
  type SettingsView,
  type Stats,
  type Status,
  type WipeResult,
  PrivacyAuditSchema,
  ProxyCheckSchema,
  I2pLookupSchema,
  type I2pLookup,
  RelayHealthReportSchema,
  RelayHistorySchema,
  type RelayHealthReport,
  type RelayHistory,
  type PrivacyAudit,
  type ProxyCheck,
} from './schemas';

export { ApiError, CONNECT_TIMEOUT_MS, toApiError, withTimeout } from '@deadhop/client';
export type { ErrorCode, ToolCaller } from '@deadhop/client';
import type { CreateInvoiceInput as PublicInvoiceInput } from '@deadhop/client';

/** A new invoice; an operator may book it to any invoice key in use (left out: the original one). */
export type CreateInvoiceInput = PublicInvoiceInput & { key?: string };

export interface ListInvoicesInput {
  status?: Status;
  before?: number;
  limit?: number;
  /** Only the invoices of this invoice key. */
  key?: string;
  /** Add the key each invoice came in on to every row. */
  with_key?: boolean;
}

/** A new invoice key. Left out: public invoicing on, not announced, relays and routes of `invoices`. */
export interface AddInvoiceKeyInput {
  id: string;
  label: string;
  description?: string;
  /** Palette index, 0 to 7. */
  color?: number;
  /** Service name given on this key; empty is the service's own. */
  name?: string;
  public_invoicing?: boolean;
  announce?: boolean;
  /** The invoice key whose relays and routes it starts with; empty: only what is set for every key. */
  copy_from?: string;
}

/** What to change on an invoice key; on the original one only `label`, `description` and `color`. */
export type UpdateInvoiceKeyInput = Partial<Omit<AddInvoiceKeyInput, 'id' | 'copy_from'>>;

/** Settings to change; anything left out stays as it is. */
export type SettingsPatch = Partial<Omit<Settings, 'sweep' | 'proxies'>> & {
  sweep?: Partial<Settings['sweep']>;
  proxies?: ProxiesPatch;
};

export type { ProxiesPatch, ProxyInput } from '@deadhop/network-ui/lib/network-api';
import { adminTarget } from './config';
import type { ProxiesPatch } from '@deadhop/network-ui/lib/network-api';

/** How long an I2P name lookup may take: the service gives registries 90 seconds. */
export const LOOKUP_TIMEOUT_MS = 120_000;

export type ControlAction = 'stop' | 'start' | 'restart';

export interface WipeInput {
  confirm: string;
  include_settings?: boolean;
  force?: boolean;
}

/** The invoice calls plus the operator tools. */
export class PayApi extends InvoiceApi {
  /** Create an invoice; an operator may name the invoice key it is booked to. */
  override createInvoice(input: CreateInvoiceInput): Promise<Invoice> {
    return super.createInvoice(input);
  }

  listInvoices(input: ListInvoicesInput = {}): Promise<InvoiceList> {
    return this.call('list_invoices', { ...input }, InvoiceListSchema);
  }

  getStats(): Promise<Stats> {
    return this.call('get_stats', {}, StatsSchema);
  }

  // ---- Operator management ----

  getHealth(): Promise<Health> {
    return this.call('get_health', {}, HealthSchema);
  }

  getMetrics(): Promise<Metrics> {
    return this.call('get_metrics', {}, MetricsSchema);
  }

  /** Payments over a range: all of them, or those of one invoice key. */
  async getSeries(range: Range, key?: string): Promise<Series> {
    const series = await this.call('get_payment_series', key === undefined ? { range } : { range, key }, SeriesSchema);
    if (series.range !== range) throw new ApiError('bad_response');
    return series;
  }

  // ---- Invoice keys ----

  /** The invoice keys, archived ones included, with the totals of invoices created since `since` (all, if left out). */
  listInvoiceKeys(since?: number): Promise<InvoiceKeyList> {
    return this.call('list_invoice_keys', since === undefined ? {} : { since }, InvoiceKeyListSchema);
  }

  addInvoiceKey(input: AddInvoiceKeyInput): Promise<InvoiceKeyList> {
    return this.call('add_invoice_key', { ...input }, InvoiceKeyListSchema);
  }

  updateInvoiceKey(id: string, patch: UpdateInvoiceKeyInput): Promise<InvoiceKeyList> {
    return this.call('update_invoice_key', { ...patch, id }, InvoiceKeyListSchema);
  }

  archiveInvoiceKey(id: string): Promise<InvoiceKeyList> {
    return this.call('archive_invoice_key', { id }, InvoiceKeyListSchema);
  }

  /** Bring an archived key back, with the relays and routes of `copyFrom` (the service's default: `invoices`). */
  restoreInvoiceKey(id: string, copyFrom?: string): Promise<InvoiceKeyList> {
    return this.call('restore_invoice_key', copyFrom === undefined ? { id } : { id, copy_from: copyFrom }, InvoiceKeyListSchema);
  }

  getSettings(): Promise<SettingsView> {
    return this.call('get_settings', {}, SettingsViewSchema);
  }

  updateSettings(patch: SettingsPatch): Promise<SettingsView> {
    return this.call('update_settings', { patch }, SettingsViewSchema);
  }

  resetSettings(): Promise<SettingsView> {
    return this.call('reset_settings', {}, SettingsViewSchema);
  }

  addOperator(pubkey: string, label: string): Promise<SettingsView> {
    return this.call('add_operator', { pubkey, label }, SettingsViewSchema);
  }

  removeOperator(pubkey: string): Promise<SettingsView> {
    return this.call('remove_operator', { pubkey }, SettingsViewSchema);
  }

  control(action: ControlAction): Promise<ControlResult> {
    return this.call('control_service', { action }, ControlResultSchema);
  }

  backup(): Promise<Backup> {
    return this.call('backup_database', {}, BackupSchema);
  }

  /** Backups kept on the service host, newest first. */
  listBackups(): Promise<BackupList> {
    return this.call('list_backups', {}, BackupListSchema);
  }

  wipe(input: WipeInput): Promise<WipeResult> {
    return this.call('wipe_database', { ...input }, WipeResultSchema);
  }

  /**
   * Test a proxy against the live relays: a listed one by `id` (its saved
   * password is used), an address, or (no argument) the one in use.
   */
  checkProxy(target?: string | { id: string }): Promise<ProxyCheck> {
    const params = target === undefined ? {} : typeof target === 'string' ? { proxy: target } : { id: target.id };
    return this.call('check_proxy', params, ProxyCheckSchema);
  }

  /**
   * Look up an I2P name (`example.i2p`) through the I2P router proxy, asking
   * every registry. It can take up to a minute and a half.
   */
  resolveI2pName(name: string): Promise<I2pLookup> {
    return this.call('resolve_i2p_name', { name }, I2pLookupSchema, LOOKUP_TIMEOUT_MS);
  }

  /** Check every live relay end to end now. */
  checkRelays(): Promise<RelayHealthReport> {
    return this.call('check_relays', {}, RelayHealthReportSchema);
  }

  /** How each relay did over a window: checks, replies, failures and a series to plot. */
  getRelayHistory(window: RelayHistory['window'] = '1h'): Promise<RelayHistory> {
    return this.call('get_relay_history', { window }, RelayHistorySchema);
  }

  getPrivacyAudit(): Promise<PrivacyAudit> {
    return this.call('get_privacy_audit', {}, PrivacyAuditSchema);
  }

  getAuditLog(limit = 50): Promise<AuditLog> {
    return this.call('get_audit_log', { limit }, AuditLogSchema);
  }
}

/** What follows a connection's activity (the dashboard's status bar). */
export interface Watcher {
  listener(): ActivityListener;
  track<T>(tool: string, work: () => Promise<T>): Promise<T>;
}

export interface Session {
  api: PayApi;
  /** Hex public key of the signed-in identity. */
  pubkey: string;
  info: Info;
  close(): Promise<void>;
}

/** Connect to the service over the configured relays and learn its parameters. */
export async function connect(
  signer: NostrSigner,
  config: Config,
  mining: MineOptions = {},
  timeoutMs = CONNECT_TIMEOUT_MS,
  watch: Watcher | null = null,
): Promise<Session> {
  const session = await connectService(signer, config, {
    mining,
    timeoutMs,
    clientName: 'deadhop-dashboard',
    onActivity: watch?.listener(),
  });
  // Every call shows in the status bar while it waits.
  const callTool: ToolCaller = watch
    ? (name, args, ms) => watch.track(name, () => session.callTool(name, args, ms))
    : session.callTool;
  return { api: new PayApi(callTool), pubkey: session.pubkey, info: session.info, close: session.close };
}

/**
 * Whether the service answers at all, for the sign-in page: one anonymous
 * request with a throwaway key to each of its keys, the public invoices key
 * on its relays and the administration key on its own. Either answering is
 * enough, and a refusal is an answer: the administration key refuses a key
 * that is not an operator's, which still proves the service is there. Only
 * silence from both (no reply, no relay) is offline. Reveals nothing but
 * online or not.
 */
export async function probeService(config: Config, open: typeof connect = connect): Promise<void> {
  const ask = async (target: Config): Promise<void> => {
    try {
      const session = await open(localSigner(undefined), target);
      await session.close();
    } catch (e) {
      if (!(e instanceof ApiError) || UNANSWERED.includes(e.code)) throw e;
    }
  };
  try {
    await Promise.any([ask(config), ask(adminTarget(config))]);
  } catch (e) {
    throw (e as AggregateError).errors[0];
  }
}

/** Errors that mean nothing answered, as opposed to the service refusing. */
const UNANSWERED: readonly string[] = ['timeout', 'network', 'bad_response'];
