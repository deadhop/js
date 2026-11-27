import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import Overview from './Overview.svelte';
import { shortKey } from '@deadhop/network-ui/lib/format';
import type { PayApi } from '../lib/api';
import { Activity } from '@deadhop/network-ui/lib/activity.svelte';
import type { RelayHealth } from '../lib/schemas';
import {
  ADMIN_PUBKEY,
  PUBKEY,
  SERVICE_PUBKEY,
  SHOP_PUBKEY,
  activePool,
  keyInfos,
  keyInfosWithShop,
  invoiceKey,
  invoiceKeyList,
  shopKey,
  proxyPool,
  adminInvoice,
  relayHistory,
  relayStats,
  health,
  metrics,
  privacyAudit,
  proxyCheck,
  series,
} from '../test-helpers';

type Fn = ReturnType<typeof vi.fn>;

function setup(
  over: Partial<Record<'getHealth' | 'getMetrics' | 'getSeries' | 'getPrivacyAudit' | 'listInvoices' | 'control' | 'checkRelays' | 'getRelayHistory' | 'listInvoiceKeys', Fn>> = {},
  props: { refreshMs?: number; onAudit?: Fn; onDrops?: Fn; onConnectivity?: Fn; onKeys?: Fn; onRelays?: Fn; copy?: Fn; confirm?: Fn } = {},
) {
  const api = {
    getHealth: vi.fn().mockResolvedValue(health()),
    getRelayHistory: vi.fn().mockResolvedValue(relayHistory()),
    getMetrics: vi.fn().mockResolvedValue(metrics()),
    getSeries: vi.fn().mockResolvedValue(series()),
    getPrivacyAudit: vi.fn().mockResolvedValue(privacyAudit()),
    control: vi.fn().mockResolvedValue({ paused: false, restart_pending: true }),
    checkRelays: vi.fn().mockResolvedValue({ relays: [] }),
    listInvoiceKeys: vi.fn().mockResolvedValue(invoiceKeyList()),
    ...over,
  };
  const all = {
    refreshMs: 60_000,
    onAudit: vi.fn(),
    onDrops: vi.fn(),
    onConnectivity: vi.fn(),
    onKeys: vi.fn(),
    onRelays: vi.fn(),
    copy: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    confirm: vi.fn().mockReturnValue(true),
    ...props,
  };
  render(Overview, { props: { api: api as unknown as PayApi, serverPubkey: PUBKEY, adminPubkey: ADMIN_PUBKEY, ...all } as never });
  return { ...api, ...all };
}

const NOW = 1_700_000_000;

/** A table row's cells, as text. */
const cells = (row: Element) => [...row.children].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());

const text = (label: string) => screen.getByText(label, { selector: '.lbl' }).parentElement!.textContent!.replace(/\s+/g, ' ').trim();

describe('Overview', () => {
  it('loads once when its calls are shown in the status bar', async () => {
    // Recording a call must not make the loading effect depend on the activity
    // (that re-ran it without end).
    const watch = new Activity();
    // After a few calls they stop answering, so a loop ends in a failed count instead of a hang.
    const waiting = <T,>(tool: string, value: T) => {
      let n = 0;
      return vi.fn(() => watch.track(tool, () => (++n > 3 ? new Promise<T>(() => undefined) : Promise.resolve(value))));
    };
    const api = setup({
      getHealth: waiting('get_health', health()),
      getMetrics: waiting('get_metrics', metrics()),
      getSeries: waiting('get_payment_series', series()),
      getRelayHistory: waiting('get_relay_history', relayHistory()),
      getPrivacyAudit: waiting('get_privacy_audit', privacyAudit()),
    });
    await waitFor(() => expect(watch.lastAnswer).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(api.getHealth).toHaveBeenCalledTimes(1);
    expect(watch.calls).toEqual([]);
  });

  it('heads the page while connecting, then shows health, totals, windows and the chart', async () => {
    const api = setup();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Loading…');
    await screen.findByRole('heading', { name: 'Serving. Dials out, never listens.' });
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('up 1h 1m · v0.1.0 · 0 restarts')).toBeTruthy();
    expect(screen.getByText('1 of 1 connected')).toBeTruthy();
    expect(screen.getByText('direct connection')).toBeTruthy();
    expect(screen.getByText('Block 101')).toBeTruthy();
    expect(screen.getByText('plain TCP · polled 2023-11-14 22:15 UTC')).toBeTruthy();
    expect(screen.getByText('Healthy')).toBeTruthy();
    expect(screen.getByText('2.0 KB · never backed up')).toBeTruthy();
    expect(text('Addresses created')).toBe('Addresses created 12 never reused');
    expect(text('Received')).toBe('Received 0.00150000 BTC 150,000 sats');
    expect(text('Payments')).toBe('Payments 3 1 in the last 24 hours');
    expect(text('Invoices')).toBe('Invoices 10 10 in the database');
    expect(screen.getByText('Last 24 hours')).toBeTruthy();
    expect(screen.getAllByText('3 so far')).toHaveLength(2);
    expect(screen.getByText('150,000 sats; complete after 30d 0h online')).toBeTruthy();
    expect(screen.getByText('off').className).toBe('badge expired');
    expect(screen.getByRole('img', { name: /buckets from/ }).getAttribute('aria-label')).toContain('100,000 sats in 7 buckets');
    expect(api.getSeries).toHaveBeenCalledWith('week');
    // One invoice key: one row, and no key switch or key column anywhere.
    const keys = screen.getByRole('region', { name: 'Invoice keys' });
    const row = [...keys.querySelectorAll('tbody tr')].map(cells);
    expect(row).toEqual([['Public invoicesoriginal', shortKey(nip19.npubEncode(SERVICE_PUBKEY)), '1 of 1', '3', '150,000 sats', '', 'Copy npub']]);
    expect(api.listInvoiceKeys).toHaveBeenCalledWith();
    expect(api.listInvoiceKeys).toHaveBeenCalledWith(NOW - 30 * 86_400);
    expect(screen.queryByRole('group', { name: 'Show takings of' })).toBeNull();
    await fireEvent.click(within(keys).getByRole('button', { name: 'Copy npub' }));
    expect(api.copy).toHaveBeenCalledWith(nip19.npubEncode(SERVICE_PUBKEY));
    await within(keys).findByRole('button', { name: 'Copied' });
    await fireEvent.click(within(keys).getByRole('button', { name: 'Manage keys' }));
    expect(api.onKeys).toHaveBeenCalled();
    // Only the administration key keeps its strip at the bottom.
    expect(screen.queryByRole('region', { name: 'Public invoices' })).toBeNull();
    const adm = screen.getByRole('region', { name: 'Administration' });
    expect(within(adm).getByText('Only operators sign in through this key. Do not publish it.')).toBeTruthy();
    expect(within(adm).queryByRole('button', { name: 'Copy nprofile' })).toBeNull();
    expect(within(adm).getByText(nip19.npubEncode(ADMIN_PUBKEY))).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: '1 year' }));
    await waitFor(() => expect(api.getSeries).toHaveBeenLastCalledWith('year'));
    expect(screen.getByRole('button', { name: '1 year' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'count' } });
    await waitFor(() => expect(screen.getByRole('img', { name: /buckets from/ }).getAttribute('aria-label')).toContain('2 payments'));
  });

  it('reports trouble in every part', async () => {
    setup({
      getHealth: vi.fn().mockResolvedValue(
        health({
          service: { version: '0.1.0', started_at: 1, uptime_secs: 59, online_since: 1, paused: true, restarts: 1, restart_pending: true },
          relays: [
            { url: 'wss://a.example', status: 'disconnected', connected: false, keys: ['admin', 'invoices'] },
            { url: 'wss://b.example', status: 'connecting', connected: false, keys: ['admin', 'invoices'] },
          ],
          proxy: 'socks5://u:***@127.0.0.1:9050',
          proxy_pool: activePool(),
          chain: { ok: false, tip_height: null, last_poll_at: null, poll_secs: 10, watch_errors: 2, backend_local: false, transport: 'tls-pinned' },
          database: { ok: false, size_bytes: 10, invoices: 0, backups: 3, last_backup_at: 1_700_000_000 },
          warnings: ['invoicing is stopped'],
        }),
      ),
      getMetrics: vi.fn().mockResolvedValue(metrics({ sweep: { enabled: true, mode: 'coinjoin', threshold_sat: 100_000, received_sat: 150_000, due: true } })),
    });
    await screen.findByRole('heading', { name: 'Invoicing stopped.' });
    expect(screen.getByText('Invoicing stopped')).toBeTruthy();
    expect(screen.getByText('up 59s · v0.1.0 · 1 restart · restarting…')).toBeTruthy();
    expect(screen.getByText('0 of 2 connected')).toBeTruthy();
    expect(screen.getByText('through the proxy')).toBeTruthy();
    expect(screen.getByText('Unreachable')).toBeTruthy();
    expect(screen.getByText('TLS, pinned certificate · not polled yet')).toBeTruthy();
    expect(screen.getByText('Integrity check failed')).toBeTruthy();
    expect(screen.getByText('10 B · backed up 2023-11-14 22:13 UTC')).toBeTruthy();
    expect(screen.getByText('2 invoices could not be read from the chain.')).toBeTruthy();
    expect(screen.getByText('The Electrum server is not on this machine.')).toBeTruthy();
    expect(screen.getByText('invoicing is stopped').closest('.warning')).not.toBeNull();
    expect(screen.getByText(/CoinJoin above 0.00100000 BTC/)).toBeTruthy();
    expect(screen.getByText('The threshold is reached: a sweep is due.').className).toBe('warning');
    expect(screen.getByText('on').className).toBe('badge confirmed');
    const relays = screen.getByRole('region', { name: 'Relays' });
    expect([...relays.querySelectorAll('.badge')].map((b) => b.className)).toEqual(['badge expired', 'badge expired']);
    expect(relays.querySelector('.dot')!.className).toBe('dot bad');
    expect(screen.getByRole('button', { name: 'Start invoicing' })).toBeTruthy();
  });

  it('handles a single unreadable invoice, an unknown height, a sweep below its threshold and errors', async () => {
    setup({
      getHealth: vi.fn().mockResolvedValue(
        health({ chain: { ok: true, tip_height: null, last_poll_at: null, poll_secs: 10, watch_errors: 1, backend_local: true, transport: 'tls' } }),
      ),
      getMetrics: vi.fn().mockResolvedValue(metrics({ sweep: { enabled: true, mode: 'payjoin', threshold_sat: 9_000_000, received_sat: 1, due: false } })),
    });
    await screen.findByText('1 invoice could not be read from the chain.');
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByText('TLS (public authorities) · not polled yet')).toBeTruthy();
    expect(screen.getByText(/PayJoin above/)).toBeTruthy();
    expect(screen.getByText('Below the threshold.').className).toBe('muted');

    document.body.innerHTML = '';
    setup({ getHealth: vi.fn().mockRejectedValue(new Error('The service had an internal error.')) });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The service had an internal error.'));
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Not loaded.');
    expect(screen.queryByRole('button', { name: 'Restart relays' })).toBeNull();
  });

  it("falls back to the config for a key the service has not reported, and does without the key list", async () => {
    // The service has not loaded the keys yet: the page's own config names them.
    const t = setup({
      getHealth: vi.fn().mockResolvedValue(health({ keys: [{ ...keyInfos()[0], pubkey: '' }, { ...keyInfos()[1], pubkey: '' }] })),
      listInvoiceKeys: vi.fn().mockRejectedValue(new Error('unknown tool')),
    });
    const adm = await screen.findByRole('region', { name: 'Administration' });
    expect(within(adm).getByText(nip19.npubEncode(ADMIN_PUBKEY))).toBeTruthy();
    const keys = screen.getByRole('region', { name: 'Invoice keys' });
    // Without the key list the figures are left blank, and the row keeps its place.
    expect(cells(keys.querySelector('tbody tr')!)).toEqual(['Public invoicesoriginal', shortKey(nip19.npubEncode(PUBKEY)), '1 of 1', '—', '—', '', 'Copy npub']);
    expect(screen.queryByRole('alert')).toBeNull();

    // A key the copy fails for says so.
    t.copy.mockRejectedValueOnce(new Error('denied'));
    await fireEvent.click(within(keys).getByRole('button', { name: 'Copy npub' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not copy: select the key and copy it by hand.');
  });

  it('tells keys apart once there are several: rows, the takings switch, the chart and the drops', async () => {
    const list = invoiceKeyList([invoiceKey({ label: 'Storefront' }), shopKey(), shopKey({ id: 'old', label: 'Pop-up', color: 3, archived_at: 1_699_900_000, pubkey: '' })]);
    const recent = invoiceKeyList([invoiceKey({ label: 'Storefront' }, { confirmed_sat: 30_000 }), shopKey({}, { confirmed_sat: 10_000, confirmed: 1 }), shopKey({ id: 'old', archived_at: 1 }, { confirmed_sat: 0 })]);
    const keys = [...keyInfosWithShop(), { id: 'cafe', label: 'Café', pubkey: '', tools: [], operators_only: false, relays: [] }];
    keys[0] = { ...keys[0], label: 'Storefront' };
    const t = setup({
      getHealth: vi.fn().mockResolvedValue(health({ keys, relays: [{ url: 'ws://127.0.0.1:7777', status: 'connected', connected: true, keys: ['admin', 'invoices', 'shop'] }] })),
      listInvoiceKeys: vi.fn((since?: number) => Promise.resolve(since === undefined ? list : recent)),
      listInvoices: vi.fn().mockResolvedValue({
        invoices: [adminInvoice({ key: 'shop' }), adminInvoice({ id: 'a'.repeat(32), index: 1, key: 'old' }), adminInvoice({ id: 'b'.repeat(32), index: 2 })],
        next_before: null,
      }),
    });
    const table = await screen.findByRole('region', { name: 'Invoice keys' });
    await waitFor(() => expect(table.querySelectorAll('tbody tr')).toHaveLength(3));
    expect([...table.querySelectorAll('tbody tr')].map(cells)).toEqual([
      ['Storefrontoriginal', shortKey(nip19.npubEncode(SERVICE_PUBKEY)), '1 of 1', '3', '30,000 sats', '', 'Copy npub'],
      ['Shop', shortKey(nip19.npubEncode(SHOP_PUBKEY)), '1 of 1', '1', '10,000 sats', '', 'Copy npub'],
      // A key the list does not know yet (and has no public key): its place's colour, no figures, nothing to copy.
      ['Café', '—', '0 of 0', '—', '0 sats', '', ''],
    ]);
    expect([...table.querySelectorAll('meter')].map((m) => m.value)).toEqual([75, 25, 0]);
    expect([...table.querySelectorAll('.key-tag')].map((c) => c.className)).toEqual(['key-tag kc0', 'key-tag kc1', 'key-tag kc2']);

    // The drops say which key each came in on.
    const drops = screen.getByRole('region', { name: 'Recent drops' });
    expect([...drops.querySelectorAll('tbody tr')].map((r) => r.children[1].textContent)).toEqual(['Shop', 'Pop-up', '—']);
    expect(drops.querySelector('.key-tag.off')!.textContent).toBe('Pop-up');
    expect(t.listInvoices).toHaveBeenCalledWith({ with_key: true });

    // The switch shows one key's takings and payments.
    const takings = screen.getByRole('group', { name: 'Show takings of' });
    expect([...takings.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['All keys', 'Storefront', 'Shop', 'Pop-up']);
    await fireEvent.click(within(takings).getByRole('button', { name: 'Shop' }));
    await waitFor(() => expect(t.getSeries).toHaveBeenLastCalledWith('week', 'shop'));
    expect(text('Received')).toBe('Received 0.00050000 BTC 50,000 sats · Shop');
    expect(text('Payments')).toBe('Payments 1 1 in the last 30 days');
    expect(text('Invoices')).toBe('Invoices 2 1 open');
    await fireEvent.click(within(takings).getByRole('button', { name: 'All keys' }));
    await waitFor(() => expect(t.getSeries).toHaveBeenLastCalledWith('week'));
    expect(text('Invoices')).toBe('Invoices 10 10 in the database');
  });

  it('warns about an added key no relay carries, with a way to the relays', async () => {
    const relays = [
      { url: 'wss://a.example', status: 'connected', connected: true, keys: ['admin', 'invoices'] },
      { url: 'wss://b.example', status: 'disconnected', connected: false, keys: ['shop'] },
      { url: 'wss://c.example', status: 'disconnected', connected: false, keys: ['shop', 'more'] },
    ];
    const extra = (id: string, label: string) => ({ id, label, pubkey: '', tools: [], operators_only: false, relays: [] });
    const keys = [...keyInfosWithShop(), extra('more', 'More'), extra('none', 'None')];
    const t = setup({ getHealth: vi.fn().mockResolvedValue(health({ keys, relays })) });
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.map((a) => a.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Shop has no relay connected. Its relays, wss://b.example and wss://c.example, are not connected. Apps cannot reach that key right now. The other keys are not affected. Give it another relay',
      'More has no relay connected. Its only relay, wss://c.example, is not connected. Apps cannot reach that key right now. The other keys are not affected. Give it another relay',
      'None has no relay connected. It has no relay at all. Apps cannot reach that key right now. The other keys are not affected. Give it another relay',
    ]);
    await fireEvent.click(within(alerts[0]).getByRole('button', { name: 'Give it another relay' }));
    expect(t.onRelays).toHaveBeenCalled();
  });

  it('refreshes on a timer', async () => {
    const api = setup({}, { refreshMs: 20 });
    await waitFor(() => expect(api.getHealth.mock.calls.length).toBeGreaterThan(2));
  });

  it('restarts the relays and stops or starts invoicing from the page head', async () => {
    const t = setup();
    await fireEvent.click(await screen.findByRole('button', { name: 'Restart relays' }));
    await waitFor(() => expect(t.control).toHaveBeenCalledWith('restart'));
    expect((await screen.findByRole('status')).textContent).toContain('Reconnecting to the relays');

    t.confirm.mockReturnValueOnce(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Stop invoicing' }));
    expect(t.control).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Stop invoicing' }));
    await waitFor(() => expect(t.control).toHaveBeenCalledWith('stop'));
    await screen.findByText(/Invoicing stopped. Payments/);

    document.body.innerHTML = '';
    const u = setup({
      getHealth: vi.fn().mockResolvedValue(health({ service: { ...health().service, paused: true } })),
      control: vi.fn().mockRejectedValue(new Error('A request was refused.')),
    });
    await fireEvent.click(await screen.findByRole('button', { name: 'Start invoicing' }));
    await waitFor(() => expect(u.control).toHaveBeenCalledWith('start'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('A request was refused.'));
  });

  it('copies with the browser clipboard by default', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const api = { getHealth: vi.fn().mockResolvedValue(health()), getRelayHistory: vi.fn().mockResolvedValue(relayHistory()), getMetrics: vi.fn().mockResolvedValue(metrics()), getSeries: vi.fn().mockResolvedValue(series()), getPrivacyAudit: vi.fn().mockResolvedValue(privacyAudit()) };
    render(Overview, { props: { api: api as unknown as PayApi, serverPubkey: PUBKEY, adminPubkey: ADMIN_PUBKEY, onAudit: vi.fn(), onDrops: vi.fn(), onConnectivity: vi.fn(), onKeys: vi.fn(), onRelays: vi.fn() } });
    await fireEvent.click(within(await screen.findByRole('region', { name: 'Invoice keys' })).getByRole('button', { name: 'Copy npub' }));
    expect(writeText).toHaveBeenCalledWith(nip19.npubEncode(SERVICE_PUBKEY));
  });

  it('asks the browser to confirm a stop by default', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const api = { getHealth: vi.fn().mockResolvedValue(health()), getRelayHistory: vi.fn().mockResolvedValue(relayHistory()), getMetrics: vi.fn().mockResolvedValue(metrics()), getSeries: vi.fn().mockResolvedValue(series()), getPrivacyAudit: vi.fn().mockRejectedValue(new Error('x')), control: vi.fn() };
    render(Overview, { props: { api: api as unknown as PayApi, serverPubkey: PUBKEY, adminPubkey: ADMIN_PUBKEY, onAudit: vi.fn(), onDrops: vi.fn(), onConnectivity: vi.fn(), onKeys: vi.fn(), onRelays: vi.fn() } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Stop invoicing' }));
    expect(ask).toHaveBeenCalled();
    expect(api.control).not.toHaveBeenCalled();
    ask.mockRestore();
  });

  it('shows the privacy score as a ring, which opens the audit', async () => {
    const t = setup();
    const tile = await screen.findByRole('button', { name: 'Privacy score 90 out of 100. Open the privacy audit' });
    expect(tile.textContent).toContain('1 thing to fix');
    expect(tile.textContent).toContain('8 of 10 checks could run here.');
    expect(tile.querySelector('svg')!.getAttribute('class')).toBe('ring small ok');
    await fireEvent.click(tile);
    expect(t.onAudit).toHaveBeenCalled();
  });

  it('colours the score and counts what to fix', async () => {
    setup({ getPrivacyAudit: vi.fn().mockResolvedValue(privacyAudit({ score: 70, checks: [] })) });
    expect((await screen.findByText('Nothing to fix')).className).toBe('big warn');

    document.body.innerHTML = '';
    const two = privacyAudit().checks.map((c) => ({ ...c, result: 'fail' as const }));
    setup({ getPrivacyAudit: vi.fn().mockResolvedValue(privacyAudit({ score: 40, checks: two })) });
    expect((await screen.findByText('4 things to fix')).className).toBe('big bad');
  });

  it('leaves the score out when the audit cannot be read', async () => {
    setup({ getPrivacyAudit: vi.fn().mockRejectedValue(new Error('unauthorized')) });
    await screen.findByText('Running');
    expect(screen.queryByText(/Privacy score/)).toBeNull();
  });

  it('shows the proxy, how fast its last check was, and when it ran', async () => {
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy: 'socks5://127.0.0.1:9050', proxy_check: proxyCheck(), proxy_pool: activePool({ proxies: [{ ...activePool().proxies[0], name: 'tor' }] }) })) });
    const tile = (await screen.findByText('online')).closest('.tile')!;
    expect(tile.querySelector('.big')!.textContent).toMatch(/^Reachable · \d+ ms$/);
    expect(tile.textContent).toContain('tor · socks5://127.0.0.1:9050 · last check connected');
    expect(tile.textContent).toContain('1 of 1 relays through it: they see the proxy, not this machine. Checked ');
  });

  it('says reachable without a time when nothing was measured, and not connected when no relay is', async () => {
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy: 'socks5://127.0.0.1:9050', proxy_pool: activePool() })) });
    const tile = (await screen.findByText('online')).closest('.tile')!;
    expect(tile.querySelector('.big')!.textContent).toBe('Reachable');
    expect(tile.textContent).toContain('Not checked yet.');

    document.body.innerHTML = '';
    const failed = proxyCheck({ status: 'failed', relays: [{ relay: 'ws://127.0.0.1:7777', ok: false, code: 'ECONNREFUSED', reason: 'refused', ms: null }] });
    setup({
      getHealth: vi.fn().mockResolvedValue(
        health({ proxy: 'socks5://127.0.0.1:9050', proxy_pool: activePool(), proxy_check: failed, relays: [{ url: 'ws://127.0.0.1:7777', status: 'connecting', connected: false, keys: ['admin', 'invoices'] }] }),
      ),
    });
    expect((await screen.findByText('Not connected')).className).toBe('big bad');
    expect(screen.getByText('offline').className).toBe('badge fail');
    expect(screen.getByText(/No relay is connected through it. Checked/)).toBeTruthy();
  });

  it('says what a transparent proxy means, and that nothing was checked', async () => {
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy_pool: proxyPool({ state: 'transparent', transparent: true }) })) });
    const tile = (await screen.findByText('declared')).closest('.tile')!;
    expect(tile.querySelector('.big')!.textContent).toBe('Transparent proxy');
    expect(tile.textContent).toContain('Not checked');
    expect(screen.getByText('through your transparent proxy')).toBeTruthy();
    expect(screen.queryByText(/can see its IP address/)).toBeNull();
  });

  it('shows a suspended rotation of the default route’s group, with the proxy in use by name', async () => {
    const p = activePool({ state: 'suspended', default: { group: 'exits' }, active: 'p2', total: 3, next_switch_at: null });
    p.proxies = [{ ...p.proxies[0], id: 'x', name: 'a', reachable: false }, { ...p.proxies[0], id: 'p2', name: '' }, { ...p.proxies[0], id: 'z', reachable: false }];
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy: 'socks5://127.0.0.1:9050', proxy_pool: p })) });
    const tile = (await screen.findByText('suspended')).closest('.tile')!;
    expect(tile.textContent).toContain('Rotation suspended');
    expect(tile.textContent).toContain('group exits: socks5://127.0.0.1:9050 · socks5://127.0.0.1:9050');
    expect(tile.textContent).toContain('Only 1 proxy in group exits is reachable, so it is not rotating; socks5://127.0.0.1:9050 keeps carrying traffic.');
  });

  it('shows the next switch of a rotation, and copes with a proxy it does not know', async () => {
    const exits = { group: 'exits', state: 'active' as const, active: 'ghost', reachable: 2, next_switch_at: 1_700_003_600 };
    const lane = { key: 'invoices', default: { group: 'exits' }, state: 'active' as const, active: 'ghost', reachable: 2, next_switch_at: 1_700_003_600, uses_default: true, groups: [exits] };
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy: 'socks5://127.0.0.1:9050', proxy_pool: activePool({ default: { group: 'exits' }, active: 'ghost', next_switch_at: 1_700_003_600, lanes: [lane] }) })) });
    const tile = (await screen.findByText('online')).closest('.tile')!;
    expect(tile.textContent).toContain('Next switch 2023-11-14 23:13 UTC.');
    expect(tile.textContent).toContain('group exits: ghost · ');
    // A single proxy never switches, though a rule's group may.
    document.body.innerHTML = '';
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy: 'socks5://127.0.0.1:9050', proxy_pool: activePool({ next_switch_at: 1_700_003_600 }) })) });
    expect((await screen.findByText('online')).closest('.tile')!.textContent).not.toContain('Next switch');
    document.body.innerHTML = '';
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy: '', proxy_pool: activePool({ active: null }) })) });
    expect((await screen.findByText('online')).closest('.tile')!.textContent).toContain('no proxy · ');
  });

  it('says what happens while the default route has nothing reachable, for each policy', async () => {
    const cases = [
      ['off', 'Kill switch: the relays on the default route are disconnected until it is back.'],
      ['admin_only', 'Relays connect straight, and only operators are served.'],
      ['invoicing_only', 'Relays connect straight, and only invoicing is served.'],
      ['open', 'Relays connect straight and everything is served.'],
    ] as const;
    for (const [posture, text] of cases) {
      document.body.innerHTML = '';
      setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy_pool: proxyPool({ state: 'offline', default: { group: 'exits' }, posture, total: 2 }) })) });
      const tile = (await screen.findByText('No proxy in group exits reachable')).closest('.tile')!;
      expect(tile.textContent).toContain(text);
      expect(tile.textContent).toContain('default route: group exits');
      expect(screen.getByText('offline').className).toBe('badge fail');
    }
  });

  it('names the one proxy of a default route that is down', async () => {
    const pool = activePool({ state: 'offline', posture: 'off', active: null });
    pool.proxies[0].name = 'tor';
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy_pool: pool })) });
    const tile = (await screen.findByText('tor down')).closest('.tile')!;
    expect(tile.textContent).toContain('default route: tor');
  });

  it('says when the default route is direct beside a proxy list, or blocks', async () => {
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy_pool: proxyPool({ state: 'direct', total: 1 }) })) });
    expect(await screen.findByText('Relays that no rule sends through a proxy connect straight to this machine and can see its IP address.')).toBeTruthy();
    expect(screen.getByText('Direct').className).toBe('big warn');
    document.body.innerHTML = '';
    setup({ getHealth: vi.fn().mockResolvedValue(health({ proxy_pool: proxyPool({ state: 'blocked', default: 'block', total: 1 }) })) });
    const tile = (await screen.findByText('Rules only')).closest('.tile')!;
    expect(tile.textContent).toContain('default route: block');
    expect(tile.textContent).toContain('Relays that no rule matches are not connected.');
  });

  it('warns when there is no proxy', async () => {
    setup();
    expect(await screen.findByText('Relays connect straight to this machine and can see its IP address.')).toBeTruthy();
    expect(screen.getByText('none').className).toBe('badge to_fix');
  });

  it('colours each relay by its end-to-end check, and checks again on demand', async () => {
    const check = (relay: string, over: Partial<RelayHealth>): RelayHealth => ({
      relay, status: 'ok', connects: true, forwards: true, rate_limited: false, ms: 84, detail: '', checked_at: 1_700_000_000, ...over,
    });
    const relays = [
      { url: 'ws://127.0.0.1:7777', status: 'connected', connected: true, keys: ['admin', 'invoices'] },
      { url: 'wss://slow.example', status: 'connected', connected: true, keys: ['invoices'] },
      { url: 'wss://gone.example', status: 'disconnected', connected: false, keys: ['admin', 'invoices'] },
      { url: 'wss://new.example', status: 'connecting', connected: false, keys: ['admin'] },
    ];
    const relay_health = [
      check('ws://127.0.0.1:7777/', {}),
      check('wss://slow.example', { status: 'degraded', forwards: false, ms: null, detail: 'The relay is rate-limiting us: rate-limited.' }),
      check('wss://gone.example', { status: 'down', connects: false, forwards: null, ms: null, detail: 'Could not connect to the relay.' }),
    ];
    const t = setup({ getHealth: vi.fn().mockResolvedValue(health({ relays, relay_health })) });
    const list = (await screen.findByRole('region', { name: 'Relays' })).querySelectorAll('li');
    const rows = [...list].map((li) => [li.querySelector('.dot')!.className, li.querySelector('.relay-note')!.textContent]);
    expect(rows).toEqual([
      ['dot ok', 'carries ContextVM events · 84 ms'],
      ['dot warn', 'The relay is rate-limiting us: rate-limited.'],
      ['dot bad', 'Could not connect to the relay.'],
      ['dot bad', 'not checked yet'],
    ]);

    // A relay only some keys use says which; one every key uses says nothing.
    expect([...list].map((li) => li.querySelector('.key-badges')?.textContent ?? '')).toEqual(['', 'Public invoices', '', 'Administration']);

    let finish: (v: unknown) => void = () => undefined;
    t.checkRelays.mockReturnValueOnce(new Promise((r) => (finish = r)));
    await fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true);
    const before = t.getHealth.mock.calls.length;
    finish({ relays: relay_health });
    await waitFor(() => expect(t.getHealth.mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByRole('button', { name: 'Check now' })).toBeTruthy();

    t.checkRelays.mockRejectedValueOnce(new Error('Too many requests; try again in a minute.'));
    await fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Too many requests; try again in a minute.'));
  });

  it("shows each relay's error rate and bars for the last day, and opens Connectivity", async () => {
    const history = relayHistory({
      relays: [relayStats({ relay: 'ws://127.0.0.1:7777/', checks: 10, check_failures: 0, sends: 30, send_failures: 1 })],
    });
    const t = setup({ getRelayHistory: vi.fn().mockResolvedValue(history) });
    const li = (await screen.findByRole('region', { name: 'Relays' })).querySelector('li')!;
    expect(li.querySelector('.rate-chip')!.textContent).toBe('2.5% errors');
    expect(li.querySelector('.rate-chip')!.className).toBe('rate-chip warn');
    expect(li.querySelector('svg.bars')!.getAttribute('aria-label')).toContain('ws://127.0.0.1:7777, last day');
    expect(t.getRelayHistory).toHaveBeenCalledWith('1d');
    await fireEvent.click(screen.getByRole('button', { name: 'Connectivity' }));
    expect(t.onConnectivity).toHaveBeenCalled();
  });

  it('leaves the error rate out when the history cannot be read', async () => {
    setup({ getRelayHistory: vi.fn().mockRejectedValue(new Error('unauthorized')) });
    const li = (await screen.findByRole('region', { name: 'Relays' })).querySelector('li')!;
    expect(li.querySelector('.rate-chip')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a relay without a check by its live connection', async () => {
    setup();
    const li = (await screen.findByRole('region', { name: 'Relays' })).querySelector('li')!;
    expect(li.querySelector('.dot')!.className).toBe('dot ok');
    expect(li.querySelector('.relay-note')!.textContent).toBe('not checked yet');
  });

  it('lists the recent drops as a table that leads to all invoices', async () => {
    const rows = [adminInvoice({ index: 0x7f3a, status: 'detected' }), adminInvoice({ id: 'e'.repeat(32), index: 1 })];
    const t = setup({ listInvoices: vi.fn().mockResolvedValue({ invoices: rows, next_before: null }) });
    const drops = await screen.findByRole('region', { name: 'Recent drops' });
    const cells = [...drops.querySelectorAll('tbody tr')].map((r) => r.querySelector('td')!.textContent);
    expect(cells).toEqual(['7F3A', '0001']);
    expect(drops.textContent).toContain(rows[0].address);
    await fireEvent.click(screen.getByRole('button', { name: 'All invoices' }));
    expect(t.onDrops).toHaveBeenCalled();
  });

  it('leaves out drops it cannot read', async () => {
    setup({ listInvoices: vi.fn().mockRejectedValue(new Error('unauthorized')) });
    await screen.findByText('Running');
    expect(screen.queryByRole('region', { name: 'Recent drops' })).toBeNull();
  });
});
