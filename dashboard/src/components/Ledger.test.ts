import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Ledger from './Ledger.svelte';
import type { PayApi } from '../lib/api';
import { invoiceKey, invoiceKeyList, settingsView, settings, shopKey } from '../test-helpers';

const NOW = 1_795_780_800; // 2026-11-27 12:00 UTC
const DAY = NOW - 86_400;

function setup(over: Partial<Record<'listInvoiceKeys' | 'getSettings', ReturnType<typeof vi.fn>>> = {}) {
  const period = invoiceKeyList(
    [
      invoiceKey({ label: 'Storefront' }, { pending: 1, detected: 1, confirmed: 3, expired: 1, confirmed_sat: 75_000 }),
      shopKey({}, { pending: 0, confirmed: 1, confirmed_sat: 25_000, last_paid_at: 1_795_000_000 }),
      shopKey({ id: 'old', label: 'Pop-up', color: 3, archived_at: 1 }, { pending: 0, confirmed: 0, confirmed_sat: 0, last_paid_at: null }),
    ],
    { since: Date.UTC(2026, 10, 1) / 1000 },
  );
  const all = invoiceKeyList([invoiceKey({ label: 'Storefront' }), shopKey(), shopKey({ id: 'old', label: 'Pop-up', archived_at: 1 }, { pending: 0 })]);
  const day = invoiceKeyList([invoiceKey({ label: 'Storefront' }, { pending: 1, detected: 0, confirmed: 1, expired: 0 }), shopKey({}, { pending: 0, confirmed: 0 })]);
  const api = {
    listInvoiceKeys: vi.fn((since?: number) => Promise.resolve(since === undefined ? all : since === DAY ? day : period)),
    getSettings: vi.fn().mockResolvedValue(settingsView({ settings: settings({ max_open_invoices: 50, max_invoices_per_day: 500 }) })),
    ...over,
  };
  const onBack = vi.fn();
  render(Ledger, { props: { api: api as unknown as PayApi, now: () => NOW, onBack } });
  return { ...api, onBack };
}

const cells = (row: Element) => [...row.children].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());

describe('Ledger', () => {
  it('splits this month’s takings by key, with a total and the shared limits', async () => {
    const t = setup();
    const share = await screen.findByRole('region', { name: 'Since 2026-11-01' });
    expect(t.listInvoiceKeys).toHaveBeenCalledWith(Date.UTC(2026, 10, 1) / 1000);
    expect(screen.getByRole('button', { name: 'November' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(share).getByRole('img').getAttribute('aria-label')).toBe('Storefront 75%, Shop 25%, Pop-up 0%');
    expect(share.querySelectorAll('.share-bar span')).toHaveLength(2);
    const rows = [...share.querySelectorAll('tbody tr, tfoot tr')].map(cells);
    expect(rows).toEqual([
      ['Storefront', '6', '3', '1', '75,000 sats', '75%', '25,000 sats', '2023-11-14 22:13 UTC'],
      ['Shop', '1', '1', '0', '25,000 sats', '25%', '25,000 sats', '2026-11-18 11:06 UTC'],
      ['Pop-up archived', '0', '0', '0', '0 sats', '0%', '0 sats', '—'],
      ['All keys', '7', '4', '1', '100,000 sats', '100%', '25,000 sats', '2026-11-18 11:06 UTC'],
    ]);
    const limits = await screen.findByRole('region', { name: 'Shared limits' });
    expect([...limits.querySelectorAll('tr')].map(cells)).toEqual([
      ['Open invoices', '', '4 of 50', 'Storefront 3 · Shop 1'],
      ['Invoices in the last 24 hours', '', '2 of 500', 'Storefront 2'],
    ]);

    await fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    await waitFor(() => expect(t.listInvoiceKeys).toHaveBeenCalledWith(NOW - 7 * 86_400));
    expect(await screen.findByRole('region', { name: 'The last 7 days' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'This year' }));
    await waitFor(() => expect(t.listInvoiceKeys).toHaveBeenCalledWith(Date.UTC(2026, 0, 1) / 1000));
    await fireEvent.click(screen.getByRole('button', { name: 'All time' }));
    expect(await screen.findByRole('region', { name: 'All time' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    expect(t.onBack).toHaveBeenCalled();
  });

  it('shows nothing to share yet, and leaves out the limits it cannot read', async () => {
    const empty = invoiceKeyList([invoiceKey({}, { pending: 0, detected: 0, confirmed: 0, expired: 0, confirmed_sat: 0, last_paid_at: null })]);
    setup({ listInvoiceKeys: vi.fn().mockResolvedValue(empty), getSettings: vi.fn().mockRejectedValue(new Error('x')) });
    const share = await screen.findByRole('region', { name: 'Since 1970-01-01' });
    expect(share.querySelector('.share-bar')).toBeNull();
    expect(cells(share.querySelector('tfoot tr')!)).toEqual(['All keys', '0', '0', '0', '0 sats', '0%', '0 sats', '—']);
    expect(screen.queryByRole('region', { name: 'Shared limits' })).toBeNull();
  });

  it('says when the figures cannot be read', async () => {
    setup({ listInvoiceKeys: vi.fn().mockRejectedValue(new Error('No answer.')) });
    expect((await screen.findByRole('alert')).textContent).toBe('No answer.');
  });
});
