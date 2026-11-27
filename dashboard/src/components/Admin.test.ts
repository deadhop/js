import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Admin from './Admin.svelte';
import type { PayApi } from '../lib/api';
import { ADMIN_PUBKEY, PUBKEY, invoiceKey, invoiceKeyList, keyInfosWithShop, shopKey, adminInvoice, audit, health, relayHistory, info, invoice, metrics, series, settingsView, stats, privacyAudit, proxyCheck } from '../test-helpers';

describe('Admin', () => {
  it('switches between the operator views', async () => {
    const api = {
      getHealth: vi.fn().mockResolvedValue(health()),
      getRelayHistory: vi.fn().mockResolvedValue(relayHistory()),
      checkRelays: vi.fn().mockResolvedValue({ relays: [] }),
      getMetrics: vi.fn().mockResolvedValue(metrics()),
      getSeries: vi.fn().mockResolvedValue(series()),
      getStats: vi.fn().mockResolvedValue(stats()),
      listInvoices: vi
        .fn()
        .mockResolvedValueOnce({ invoices: [adminInvoice()], next_before: null })
        .mockResolvedValue({ invoices: [], next_before: null }),
      createInvoice: vi.fn().mockResolvedValue(invoice()),
      getSettings: vi.fn().mockResolvedValue(settingsView()),
      getAuditLog: vi.fn().mockResolvedValue(audit()),
      listBackups: vi.fn().mockResolvedValue({ backups: [] }),
      getPrivacyAudit: vi.fn().mockResolvedValue(privacyAudit()),
      checkProxy: vi.fn().mockResolvedValue(proxyCheck()),
      listInvoiceKeys: vi.fn().mockResolvedValue(invoiceKeyList()),
    };
    render(Admin, {
      props: { api: api as unknown as PayApi, info: info({ is_admin: true }), onCreated: vi.fn(), dashboardRelays: ['ws://127.0.0.1:7777'], serverPubkey: PUBKEY, adminPubkey: ADMIN_PUBKEY, onSettingsChanged: vi.fn() },
    });
    await screen.findByText('Addresses created');
    expect(screen.getByRole('region', { name: 'Invoice keys' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Administration' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');

    // "All invoices" under the recent drops opens the Invoices tab.
    await fireEvent.click(await screen.findByRole('button', { name: 'All invoices' }));
    await screen.findByText('No invoices yet.');
    expect(screen.getByRole('button', { name: 'Invoices' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBeNull();

    // Keys sits between Invoices and Network.
    expect([...screen.getByRole('navigation', { name: 'Operator' }).querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Overview',
      'Invoices',
      'Keys',
      'Network',
      'Settings',
      'Operators',
      'Maintenance',
    ]);
    await fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    await screen.findByRole('heading', { name: 'One address per service' });
    expect(screen.getByRole('button', { name: 'Keys' }).getAttribute('aria-current')).toBe('page');

    await fireEvent.click(screen.getByRole('button', { name: 'Network' }));
    // Network opens on the routes, and its views switch in place.
    await screen.findByRole('tab', { name: 'Routes' });
    expect(screen.getByRole('button', { name: 'Network' }).getAttribute('aria-current')).toBe('page');
    await fireEvent.click(screen.getByRole('tab', { name: /^Relays/ }));
    await screen.findByRole('heading', { name: 'Relays' });
    await fireEvent.click(screen.getByRole('tab', { name: /^Proxies/ }));
    await screen.findByRole('heading', { name: 'Proxies' });
    await fireEvent.click(screen.getByRole('tab', { name: /^Rules/ }));
    await screen.findByRole('heading', { name: 'Rules' });

    await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByRole('heading', { name: 'Abuse protection' });
    expect(screen.queryByRole('heading', { name: 'Proxies' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Operators' }));
    await screen.findByRole('heading', { name: 'Audit log' });
    expect(screen.getByRole('heading', { name: 'Who can run this service' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Maintenance' }));
    await screen.findByRole('heading', { name: 'Wipe invoices' });

    // The privacy score opens the audit, which belongs to the Overview tab.
    await fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    await fireEvent.click(await screen.findByRole('button', { name: /^Privacy score/ }));
    await screen.findByRole('heading', { name: 'Network location' });
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    await fireEvent.click(screen.getByRole('button', { name: '← Overview' }));
    await screen.findByText('Addresses created');

    // The Connectivity page belongs to the Overview tab, and leads back to it.
    await fireEvent.click(screen.getByRole('button', { name: 'Connectivity' }));
    await screen.findByRole('heading', { level: 1, name: 'Relays' });
    expect(screen.getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
    await fireEvent.click(screen.getByRole('button', { name: '← Overview' }));
    await screen.findByText('Addresses created');
  });

  it('leads from the keys to their invoices and relays, and shares the keys’ colours', async () => {
    const relays = [
      { url: 'ws://127.0.0.1:7777', status: 'connected', connected: true, keys: ['admin', 'invoices'] },
      { url: 'wss://b.example', status: 'disconnected', connected: false, keys: ['shop'] },
    ];
    const keys = invoiceKeyList([invoiceKey(), shopKey({ color: 5 })]);
    const api = {
      getHealth: vi.fn().mockResolvedValue(health({ keys: keyInfosWithShop(), relays })),
      getRelayHistory: vi.fn().mockResolvedValue(relayHistory()),
      getMetrics: vi.fn().mockResolvedValue(metrics()),
      getSeries: vi.fn().mockResolvedValue(series()),
      getStats: vi.fn().mockResolvedValue(stats()),
      listInvoices: vi.fn().mockResolvedValue({ invoices: [adminInvoice({ key: 'shop' })], next_before: null }),
      getSettings: vi.fn().mockResolvedValue(settingsView({ fixed: { ...settingsView().fixed, keys: keyInfosWithShop() } })),
      getPrivacyAudit: vi.fn().mockResolvedValue(privacyAudit()),
      listInvoiceKeys: vi.fn().mockResolvedValue(keys),
      updateInvoiceKey: vi.fn().mockResolvedValue(invoiceKeyList([invoiceKey(), shopKey({ color: 6 })])),
    };
    render(Admin, {
      props: { api: api as unknown as PayApi, info: info({ is_admin: true }), onCreated: vi.fn(), dashboardRelays: ['ws://127.0.0.1:7777'], serverPubkey: PUBKEY, adminPubkey: ADMIN_PUBKEY, onSettingsChanged: vi.fn() },
    });
    // The cut-off key's warning opens the relays.
    await fireEvent.click(await screen.findByRole('button', { name: 'Give it another relay' }));
    await screen.findByRole('heading', { name: 'Relays' });
    expect(screen.getByRole('button', { name: 'Network' }).getAttribute('aria-current')).toBe('page');

    // From the Overview's key table to the Keys tab, and from a key to its invoices.
    await fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Manage keys' }));
    const card = await screen.findByRole('article', { name: 'Shop' });
    await fireEvent.click(within(card).getByRole('button', { name: 'Invoices' }));
    expect(((await screen.findByLabelText('Key')) as HTMLSelectElement).value).toBe('shop');
    await waitFor(() => expect(api.listInvoices).toHaveBeenLastCalledWith({ key: 'shop', with_key: true }));
    // Opened from the bar, the list shows every key again.
    const bar = within(screen.getByRole('navigation', { name: 'Operator' }));
    await fireEvent.click(bar.getByRole('button', { name: 'Keys' }));
    await fireEvent.click(bar.getByRole('button', { name: 'Invoices' }));
    expect(((await screen.findByLabelText('Key')) as HTMLSelectElement).value).toBe('');

    // A key's page leads to the routes, and a new colour reaches the views.
    await fireEvent.click(bar.getByRole('button', { name: 'Keys' }));
    await fireEvent.click(within(await screen.findByRole('article', { name: 'Shop' })).getByRole('button', { name: 'Open' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Sky' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateInvoiceKey).toHaveBeenCalled());
    await fireEvent.click(screen.getByRole('button', { name: 'Edit under Network' }));
    await screen.findByRole('tab', { name: 'Routes' });
  });

  it('does without the keys’ colours', async () => {
    const api = {
      getHealth: vi.fn().mockResolvedValue(health()),
      getRelayHistory: vi.fn().mockResolvedValue(relayHistory()),
      getMetrics: vi.fn().mockResolvedValue(metrics()),
      getSeries: vi.fn().mockResolvedValue(series()),
      listInvoices: vi.fn().mockResolvedValue({ invoices: [], next_before: null }),
      getPrivacyAudit: vi.fn().mockResolvedValue(privacyAudit()),
      listInvoiceKeys: vi.fn().mockRejectedValue(new Error('unknown tool')),
    };
    render(Admin, {
      props: { api: api as unknown as PayApi, info: info({ is_admin: true }), onCreated: vi.fn(), dashboardRelays: [], serverPubkey: PUBKEY, adminPubkey: ADMIN_PUBKEY, onSettingsChanged: vi.fn() },
    });
    await screen.findByText('Addresses created');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
