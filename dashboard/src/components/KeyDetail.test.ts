import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import { shortKey } from '@deadhop/network-ui/lib/format';
import KeyDetail from './KeyDetail.svelte';
import type { PayApi } from '../lib/api';
import type { InvoiceKeyInfo } from '../lib/schemas';
import { PUBKEY, SERVICE_PUBKEY, SHOP_PUBKEY, health, info, invoiceKey, invoiceKeyList, keyInfosWithShop, settings, settingsView, shopKey } from '../test-helpers';

type Fn = ReturnType<typeof vi.fn<(...args: any[]) => any>>;
const NOW = 1_795_780_800;
const relays = [
  { url: 'ws://127.0.0.1:7777', status: 'connected', connected: true, keys: ['admin', 'invoices', 'shop'] },
  { url: 'wss://b.example', status: 'connecting', connected: false, keys: ['shop'] },
];

function setup(key: InvoiceKeyInfo, over: Partial<Record<keyof PayApi, Fn>> = {}, copy: Fn = vi.fn().mockResolvedValue(undefined)) {
  const api = {
    listInvoiceKeys: vi.fn().mockResolvedValue(invoiceKeyList([invoiceKey(), shopKey({}, { pending: 1, detected: 0, confirmed: 1, expired: 0 })])),
    getSettings: vi.fn().mockResolvedValue(settingsView({ settings: settings({ max_invoices_per_day: 500 }) })),
    updateInvoiceKey: vi.fn().mockResolvedValue(invoiceKeyList()),
    archiveInvoiceKey: vi.fn().mockResolvedValue(invoiceKeyList()),
    ...over,
  };
  const cb = { onBack: vi.fn(), onLedger: vi.fn(), onInvoices: vi.fn(), onNetwork: vi.fn(), onChanged: vi.fn(), onArchived: vi.fn() };
  render(KeyDetail, {
    props: {
      api: api as unknown as PayApi,
      info: info({ is_admin: true, name: 'Corner Bakery' }),
      key,
      recent: { ...key.totals, confirmed: 4, confirmed_sat: 151_000 },
      health: health({ keys: keyInfosWithShop(), relays }),
      now: () => NOW,
      copy,
      ...cb,
    },
  });
  return { ...api, ...cb, copy };
}

describe('KeyDetail', () => {
  it('gives an added key’s address in every form, its figures and relays', async () => {
    const key = shopKey({ relays: ['ws://127.0.0.1:7777', 'wss://b.example'] });
    const t = setup(key);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Shop');
    expect(screen.getByText(/Shop checkout · added 2023-11-09/).textContent).toContain(`by ${shortKey(nip19.npubEncode(PUBKEY))}`);
    expect(screen.getByText(/1 of 2 relays connected/)).toBeTruthy();
    const figures = screen.getByRole('region', { name: 'Figures' });
    await waitFor(() => expect(figures.textContent).toContain('2 / 500'));
    expect(t.listInvoiceKeys).toHaveBeenCalledWith(NOW - 86_400);
    expect([...figures.querySelectorAll('.big')].map((b) => b.textContent)).toEqual(['151,000 sats', '4', '1', '2 / 500']);

    const npub = nip19.npubEncode(SHOP_PUBKEY);
    expect(screen.getByText(npub)).toBeTruthy();
    expect(screen.getByText(SHOP_PUBKEY)).toBeTruthy();
    const buttons = screen.getAllByRole('button', { name: 'Copy' });
    await fireEvent.click(buttons[0]);
    expect(t.copy).toHaveBeenLastCalledWith(npub);
    await fireEvent.click(buttons[1]);
    expect(t.copy).toHaveBeenLastCalledWith(SHOP_PUBKEY);
    await fireEvent.click(buttons[2]);
    const profile = nip19.decode(t.copy.mock.lastCall![0] as string);
    expect(profile.type === 'nprofile' && profile.data).toEqual({ pubkey: SHOP_PUBKEY, relays: ['ws://127.0.0.1:7777', 'wss://b.example'] });
    expect(screen.getByText(/with 2 relays$/)).toBeTruthy();
    const code = document.querySelector('pre.snippet')!.textContent!;
    expect(code).toContain(`serverPubkey: '${npub}'`);
    expect(code).toContain(`relays: ['ws://127.0.0.1:7777', 'wss://b.example']`);
    await fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(t.copy).toHaveBeenLastCalledWith(code);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy();

    const list = screen.getByRole('region', { name: 'Relays and routes' });
    expect([...list.querySelectorAll('li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['ws://127.0.0.1:7777 connected', 'wss://b.example connecting']);
    await fireEvent.click(within(list).getByRole('button', { name: 'Edit under Network' }));
    expect(t.onNetwork).toHaveBeenCalledWith('routes');
    await fireEvent.click(screen.getByRole('button', { name: 'Its invoices' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Ledger' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    expect([t.onInvoices, t.onLedger, t.onBack].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);

    t.copy.mockRejectedValueOnce(new Error('denied'));
    await fireEvent.click(buttons[0]);
    expect((await screen.findByRole('alert')).textContent).toBe('Could not copy: select the text and copy it by hand.');
  });

  it('saves every setting of an added key', async () => {
    const t = setup(shopKey());
    expect((screen.getByLabelText('Name shown to apps') as HTMLInputElement).placeholder).toBe('Corner Bakery (the service name)');
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: ' Shop 2 ' } });
    await fireEvent.input(screen.getByLabelText('What it is for'), { target: { value: ' Online ' } });
    await fireEvent.input(screen.getByLabelText('Name shown to apps'), { target: { value: ' Bakery shop ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Sky' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /Anyone may create invoices/ }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /Announce it/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(t.updateInvoiceKey).toHaveBeenCalledWith('shop', { label: 'Shop 2', description: 'Online', color: 6, name: 'Bakery shop', public_invoicing: false, announce: true }),
    );
    expect(t.onChanged).toHaveBeenCalledWith(invoiceKeyList());
    expect((await screen.findByRole('status')).textContent).toBe('Saved.');

    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: '  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toBe('Give the key a name.');
    t.updateInvoiceKey.mockRejectedValueOnce(new Error('label must be 1 to 40 visible characters'));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Shop' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('label must be 1 to 40 visible characters');
  });

  it('archives an added key once its id is typed', async () => {
    const t = setup(shopKey({ created_by: '' }));
    expect(screen.getByText(/Shop checkout · added 2023-11-09 \d\d:\d\d UTC ·/)).toBeTruthy();
    const archive = screen.getByRole('button', { name: 'Archive' }) as HTMLButtonElement;
    expect(archive.disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText(/to confirm/), { target: { value: 'sho' } });
    expect(archive.disabled).toBe(true);
    t.archiveInvoiceKey.mockRejectedValueOnce(new Error('wss://b.example is used by shop alone: give it another key first.'));
    await fireEvent.input(screen.getByLabelText(/to confirm/), { target: { value: 'shop' } });
    await fireEvent.click(archive);
    expect((await screen.findByRole('alert')).textContent).toBe('wss://b.example is used by shop alone: give it another key first.');
    expect(archive.disabled).toBe(false);
    await fireEvent.click(archive);
    await waitFor(() => expect(t.onArchived).toHaveBeenCalledWith(invoiceKeyList()));
    expect(t.archiveInvoiceKey).toHaveBeenCalledWith('shop');
  });

  it('lets the original key change only its name, description and colour, and never archives it', async () => {
    const t = setup(invoiceKey({ label: 'Storefront', relays: ['ws://127.0.0.1:7777'] }), { getSettings: vi.fn().mockRejectedValue(new Error('x')) });
    expect(screen.getByText(/the original key/)).toBeTruthy();
    expect(screen.queryByLabelText('Name shown to apps')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Archive this key' })).toBeNull();
    expect(screen.getByText(/with 1 relay$/)).toBeTruthy();
    expect(screen.getByText(SERVICE_PUBKEY)).toBeTruthy();
    // Without the settings the cap is left out.
    await waitFor(() => expect(t.getSettings).toHaveBeenCalled());
    expect(screen.queryByText('Of today’s cap')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(t.updateInvoiceKey).toHaveBeenCalledWith('invoices', { label: 'Storefront', description: '', color: 0 }));
  });

  it('says when a key is not loaded yet, or has no relay', async () => {
    setup(shopKey({ id: 'none', pubkey: '', relays: [] }));
    expect(screen.getByText('The service has not loaded this key yet.')).toBeTruthy();
    expect(screen.getByText('It uses no relay now.')).toBeTruthy();
    expect(screen.getByText(/0 of 0 relays connected/)).toBeTruthy();
  });
});
