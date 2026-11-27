import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import { shortKey } from '@deadhop/network-ui/lib/format';
import Keys from './Keys.svelte';
import type { PayApi } from '../lib/api';
import { ADMIN_PUBKEY, SHOP_PUBKEY, health, info, invoiceKey, invoiceKeyList, keyInfos, keyInfosWithShop, settingsView, shopKey } from '../test-helpers';

type Fn = ReturnType<typeof vi.fn<(...args: any[]) => any>>;
const NOW = 1_795_780_800; // 2026-11-27 12:00 UTC

const relays = [
  { url: 'ws://127.0.0.1:7777', status: 'connected', connected: true, keys: ['admin', 'invoices', 'shop'] },
  { url: 'wss://b.example', status: 'connecting', connected: false, keys: ['shop'] },
];
const archived = shopKey({ id: 'popup', label: 'Pop-up', color: 3, archived_at: 1_700_000_000, pubkey: '' }, { confirmed: 9, confirmed_sat: 214_500 });
const list = (keys = [invoiceKey({ label: 'Storefront', description: 'Shop checkout', announce: true }), shopKey({ public_invoicing: false }), archived]) => invoiceKeyList(keys);

function setup(over: Partial<Record<keyof PayApi, Fn>> = {}, props: { copy?: Fn; refreshMs?: number } = {}) {
  const api = {
    getHealth: vi.fn().mockResolvedValue(health({ keys: keyInfosWithShop(), relays })),
    listInvoiceKeys: vi.fn((since?: number) => Promise.resolve(since === undefined ? list() : invoiceKeyList(list().keys.map((k) => ({ ...k, totals: { ...k.totals, confirmed_sat: 1_000 } }))))),
    restoreInvoiceKey: vi.fn().mockResolvedValue(list()),
    getSettings: vi.fn().mockResolvedValue(settingsView()),
    ...over,
  };
  const all = { onInvoices: vi.fn(), onNetwork: vi.fn(), onChanged: vi.fn(), copy: vi.fn().mockResolvedValue(undefined), refreshMs: 60_000, ...props };
  render(Keys, { props: { api: api as unknown as PayApi, info: info({ is_admin: true, name: 'Corner Bakery' }), adminPubkey: ADMIN_PUBKEY, now: () => NOW, ...all } });
  return { ...api, ...all };
}

describe('Keys', () => {
  it('shows a card per invoice key in use, the administration key and the archived ones', async () => {
    const t = setup();
    const store = await screen.findByRole('article', { name: 'Storefront' });
    expect(t.listInvoiceKeys).toHaveBeenCalledWith(NOW - 30 * 86_400);
    expect(screen.getByRole('heading', { name: 'Invoice keys 2 of 7' })).toBeTruthy();
    expect(within(store).getByText('original')).toBeTruthy();
    expect(within(store).getByText('Shop checkout')).toBeTruthy();
    const facts = (el: HTMLElement) => [...el.querySelectorAll('dd')].map((d) => d.textContent!.trim());
    expect(facts(store)).toEqual(['1 of 1 connected', '3', '1,000 sats', 'on · announced']);
    const shop = screen.getByRole('article', { name: 'Shop' });
    expect(within(shop).queryByText('original')).toBeNull();
    expect(facts(shop)).toEqual(['1 of 2 connected', '1', '1,000 sats', 'off · not announced']);
    expect(shop.querySelector('.dot')!.className).toBe('dot warn');
    expect(within(shop).getByText(shortKey(nip19.npubEncode(SHOP_PUBKEY)))).toBeTruthy();

    await fireEvent.click(within(shop).getByRole('button', { name: 'Copy' }));
    expect(t.copy).toHaveBeenCalledWith(nip19.npubEncode(SHOP_PUBKEY));
    await within(shop).findByRole('button', { name: 'Copied' });
    t.copy.mockRejectedValueOnce(new Error('denied'));
    await fireEvent.click(within(store).getByRole('button', { name: 'Copy' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not copy: select the key and copy it by hand.');

    await fireEvent.click(within(shop).getByRole('button', { name: 'Invoices' }));
    expect(t.onInvoices).toHaveBeenCalledWith('shop');

    const admin = screen.getByRole('region', { name: 'Administration' });
    expect(within(admin).getByText(shortKey(nip19.npubEncode(ADMIN_PUBKEY)))).toBeTruthy();

    const old = screen.getByRole('region', { name: 'Archived' });
    expect(within(old).getByText('Pop-up').className).toBe('key-tag kc3 off');
    expect(within(old).getByText('archived 2023-11-14 22:13 UTC · 10 invoices · 214,500 sats')).toBeTruthy();
    // A key not loaded has no npub to copy.
    expect(within(old).getByText('—')).toBeTruthy();
    await fireEvent.click(within(old).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(t.restoreInvoiceKey).toHaveBeenCalledWith('popup'));
    expect(t.onChanged).toHaveBeenCalledWith(list());
    expect((await screen.findByRole('status')).textContent).toBe('Pop-up is back, with the relays and routes of the original key.');
  });

  it('uses the configured administration key until the service reports one, and says when a restore fails', async () => {
    const [invoices, admin] = keyInfos();
    setup({
      getHealth: vi.fn().mockResolvedValue(health({ keys: [invoices, { ...admin, pubkey: '' }] })),
      restoreInvoiceKey: vi.fn().mockRejectedValue(new Error('All 7 invoice keys are in use.')),
    });
    const strip = await screen.findByRole('region', { name: 'Administration' });
    expect(within(strip).getByText(shortKey(nip19.npubEncode(ADMIN_PUBKEY)))).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect((await screen.findByRole('alert')).textContent).toBe('All 7 invoice keys are in use.');
  });

  it('stops adding and restoring at the limit, and hides an empty archive', async () => {
    // A key the service has not loaded yet has nothing to copy.
    const seven = [invoiceKey(), ...[1, 2, 3, 4, 5, 6].map((i) => shopKey({ id: `k${i}`, label: `Key ${i}`, color: i, pubkey: i === 1 ? '' : SHOP_PUBKEY }))];
    setup({ listInvoiceKeys: vi.fn().mockResolvedValue(invoiceKeyList(seven)) });
    const add = (await screen.findByRole('button', { name: 'Add invoice key' })) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('All 7 invoice keys are in use. Archive one to add another.');
    expect(screen.getByText('All 7 invoice keys are in use. Archive one to add another.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Archived' })).toBeNull();
    expect(within(screen.getByRole('article', { name: 'Key 1' })).queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('reports a failed load, and loads again on a timer', async () => {
    setup({ getHealth: vi.fn().mockRejectedValue(new Error('No answer.')) });
    expect((await screen.findByRole('alert')).textContent).toBe('No answer.');
    expect(screen.queryByRole('button', { name: 'Add invoice key' })).toBeNull();
    document.body.innerHTML = '';
    const t = setup({}, { refreshMs: 20 });
    await waitFor(() => expect(t.getHealth.mock.calls.length).toBeGreaterThan(2));
  });

  it('opens the form, a key and the ledger, and comes back', async () => {
    const t = setup({
      addInvoiceKey: vi.fn().mockResolvedValue(list([invoiceKey(), shopKey(), shopKey({ id: 'bread-club', label: 'Bread club' })])),
      archiveInvoiceKey: vi.fn().mockResolvedValue(list()),
    });
    await fireEvent.click(await screen.findByRole('button', { name: 'Add invoice key' }));
    await screen.findByRole('heading', { name: 'Add an invoice key' });
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Add invoice key' }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Bread club' } });
    t.listInvoiceKeys.mockImplementation(() => Promise.resolve(list([invoiceKey(), shopKey(), shopKey({ id: 'bread-club', label: 'Bread club' })])));
    await fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    // A new key opens on its own page.
    expect(await screen.findByRole('heading', { level: 1, name: 'Bread club' })).toBeTruthy();
    expect(t.onChanged).toHaveBeenCalled();

    await fireEvent.click(screen.getAllByRole('button', { name: 'Copy' })[0]);
    expect(t.copy).toHaveBeenCalledWith(nip19.npubEncode(SHOP_PUBKEY));
    await fireEvent.click(screen.getByRole('button', { name: 'Its invoices' }));
    expect(t.onInvoices).toHaveBeenCalledWith('bread-club');
    await fireEvent.click(screen.getByRole('button', { name: 'Edit under Network' }));
    expect(t.onNetwork).toHaveBeenCalledWith('routes');

    // Archiving goes back to the list and says so.
    await fireEvent.input(screen.getByLabelText(/to confirm/), { target: { value: 'bread-club' } });
    t.listInvoiceKeys.mockImplementation(() => Promise.resolve(list()));
    await fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect((await screen.findByRole('status')).textContent).toBe('Bread club is archived.');
    expect(screen.getByRole('heading', { level: 1, name: 'One address per service' })).toBeTruthy();

    await fireEvent.click(within(screen.getByRole('article', { name: 'Shop' })).getByRole('button', { name: 'Open' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Ledger' }));
    expect(await screen.findByRole('heading', { name: 'Who took what' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Ledger' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Keys' }));
    await fireEvent.click(within(await screen.findByRole('article', { name: 'Shop' })).getByRole('button', { name: 'Open' }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Keys' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'One address per service' })).toBeTruthy();
  });

  it('uses the browser clipboard by default', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const api = { getHealth: vi.fn().mockResolvedValue(health()), listInvoiceKeys: vi.fn().mockResolvedValue(invoiceKeyList()) };
    render(Keys, { props: { api: api as unknown as PayApi, info: info(), adminPubkey: ADMIN_PUBKEY, onInvoices: vi.fn(), onNetwork: vi.fn(), onChanged: vi.fn() } });
    await fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalled();
  });
});
