import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import CreateInvoice from './CreateInvoice.svelte';
import type { PayApi } from '../lib/api';
import { info, invoice, invoiceKey, invoiceKeyList, shopKey } from '../test-helpers';

function setup(over: Parameters<typeof info>[0] = {}, createInvoice = vi.fn().mockResolvedValue(invoice())) {
  const onCreated = vi.fn();
  render(CreateInvoice, { props: { api: { createInvoice } as unknown as PayApi, info: info(over), onCreated } });
  const amount = screen.getByLabelText('Amount (sats)') as HTMLInputElement;
  const memo = screen.getByLabelText('Note (optional)') as HTMLInputElement;
  const submit = () => fireEvent.submit(amount.closest('form')!);
  return { createInvoice, onCreated, amount, memo, submit };
}

describe('CreateInvoice', () => {
  it('validates the amount before calling the service', async () => {
    const t = setup();
    for (const bad of ['', 'abc', '12.5', '999', '100000001']) {
      await fireEvent.input(t.amount, { target: { value: bad } });
      await t.submit();
      expect(screen.getByRole('alert').textContent, bad).toContain('between 1,000 sats and 100,000,000 sats');
    }
    expect(t.createInvoice).not.toHaveBeenCalled();
  });

  it('creates an invoice, reports it and resets the form', async () => {
    const t = setup();
    await fireEvent.input(t.amount, { target: { value: '50000' } });
    await fireEvent.input(t.memo, { target: { value: '  table 4 ' } });
    await t.submit();
    await waitFor(() => expect(t.onCreated).toHaveBeenCalledWith(invoice()));
    expect(t.createInvoice).toHaveBeenCalledWith({ amount_sat: 50000, memo: 'table 4' });
    expect(t.amount.value).toBe('');
    expect(t.memo.value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('omits an empty note', async () => {
    const t = setup();
    await fireEvent.input(t.amount, { target: { value: '1000' } });
    await fireEvent.input(t.memo, { target: { value: '   ' } });
    await t.submit();
    await waitFor(() => expect(t.createInvoice).toHaveBeenCalledWith({ amount_sat: 1000 }));
  });

  it('tells the public that proof of work is being computed', async () => {
    let finish!: (value: unknown) => void;
    const pending = vi.fn(() => new Promise((resolve) => (finish = resolve)));
    const t = setup({ pow_bits: 20 }, pending);
    await fireEvent.input(t.amount, { target: { value: '5000' } });
    await t.submit();
    expect(screen.getByRole('status').textContent).toBe('Computing proof of work (20 bits)…');
    expect((screen.getByRole('button', { name: 'Create invoice' }) as HTMLButtonElement).disabled).toBe(true);
    finish(invoice());
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });

  it('skips the proof-of-work notice for operators and when none is required', async () => {
    for (const over of [{ is_admin: true, pow_bits: 20 }, { pow_bits: 0 }]) {
      const pending = vi.fn(() => new Promise(() => undefined));
      const t = setup(over, pending);
      await fireEvent.input(t.amount, { target: { value: '5000' } });
      await t.submit();
      expect(screen.getByRole('status').textContent).toBe('Creating…');
      document.body.innerHTML = '';
    }
  });

  it('shows service errors', async () => {
    const t = setup({}, vi.fn().mockRejectedValue(new Error('Too many requests. Wait a minute and try again.')));
    await fireEvent.input(t.amount, { target: { value: '5000' } });
    await t.submit();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Too many requests'));
    expect(t.onCreated).not.toHaveBeenCalled();
    expect(t.amount.value).toBe('5000');
  });

  describe('booking to an invoice key', () => {
    const NOW = 1_795_780_800; // 2026-11-27 12:00 UTC
    function operator(listInvoiceKeys: ReturnType<typeof vi.fn>, defaultKey?: string) {
      const createInvoice = vi.fn().mockResolvedValue(invoice());
      const api = { createInvoice, listInvoiceKeys };
      render(CreateInvoice, { props: { api: api as unknown as PayApi, info: info({ is_admin: true }), onCreated: vi.fn(), now: () => NOW, ...(defaultKey === undefined ? {} : { defaultKey }) } });
      return { createInvoice, amount: screen.getByLabelText('Amount (sats)') as HTMLInputElement };
    }
    const keys = invoiceKeyList([invoiceKey({ label: 'Storefront' }, { pending: 0, detected: 0, confirmed: 1, expired: 0 }), shopKey({}, { pending: 3, confirmed: 2, expired: 7 }), shopKey({ id: 'old', label: 'Old', archived_at: 1 })]);

    it('offers each key in use with this month’s count, starting on the original one', async () => {
      const list = vi.fn().mockResolvedValue(keys);
      const t = operator(list);
      const group = await screen.findByRole('group', { name: 'Book it to' });
      expect(list).toHaveBeenCalledWith(Date.UTC(2026, 10, 1) / 1000);
      // Archived keys take no invoices.
      expect([...group.querySelectorAll('label')].map((l) => l.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Storefront1 invoice this month', 'Shop12 invoices this month']);
      expect((screen.getByRole('radio', { name: /Storefront/ }) as HTMLInputElement).checked).toBe(true);
      await fireEvent.click(screen.getByRole('radio', { name: /Shop/ }));
      await fireEvent.input(t.amount, { target: { value: '5000' } });
      await fireEvent.click(screen.getByRole('button', { name: 'Create on Shop' }));
      await waitFor(() => expect(t.createInvoice).toHaveBeenCalledWith({ amount_sat: 5000, key: 'shop' }));
    });

    it('starts on the key it is given', async () => {
      const t = operator(vi.fn().mockResolvedValue(keys), 'shop');
      await screen.findByRole('button', { name: 'Create on Shop' });
      await fireEvent.input(t.amount, { target: { value: '5000' } });
      await fireEvent.submit(t.amount.closest('form')!);
      await waitFor(() => expect(t.createInvoice).toHaveBeenCalledWith({ amount_sat: 5000, key: 'shop' }));
    });

    it('asks nothing with one key in use, without the list, or of the public', async () => {
      for (const list of [vi.fn().mockResolvedValue(invoiceKeyList()), vi.fn().mockRejectedValue(new Error('x'))]) {
        const t = operator(list);
        await waitFor(() => expect(list).toHaveBeenCalled());
        await fireEvent.input(t.amount, { target: { value: '5000' } });
        await fireEvent.submit(t.amount.closest('form')!);
        await waitFor(() => expect(t.createInvoice).toHaveBeenCalledWith({ amount_sat: 5000 }));
        expect(screen.queryByRole('group', { name: 'Book it to' })).toBeNull();
        document.body.innerHTML = '';
      }
      const listInvoiceKeys = vi.fn();
      render(CreateInvoice, { props: { api: { listInvoiceKeys } as unknown as PayApi, info: info(), onCreated: vi.fn() } });
      expect(listInvoiceKeys).not.toHaveBeenCalled();
    });
  });
});
