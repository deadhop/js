import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import AddKey from './AddKey.svelte';
import type { PayApi } from '../lib/api';
import { invoiceKey, invoiceKeyList, shopKey } from '../test-helpers';

function setup(addInvoiceKey = vi.fn().mockResolvedValue(invoiceKeyList())) {
  const onAdded = vi.fn();
  const onCancel = vi.fn();
  const keys = [invoiceKey({ label: 'Storefront' }), shopKey(), shopKey({ id: 'old', label: 'Old', color: 2, archived_at: 1 })];
  render(AddKey, { props: { api: { addInvoiceKey } as unknown as PayApi, keys, onAdded, onCancel } });
  const name = screen.getByLabelText('Name') as HTMLInputElement;
  const id = screen.getByLabelText('Id') as HTMLInputElement;
  return { addInvoiceKey, onAdded, onCancel, name, id, create: () => fireEvent.click(screen.getByRole('button', { name: 'Create key' })) };
}

describe('AddKey', () => {
  it('suggests an id from the name until one is typed, and sends the defaults', async () => {
    const t = setup();
    await fireEvent.input(t.name, { target: { value: 'Bread club' } });
    expect(t.id.value).toBe('bread-club');
    // The first colour no key in use has (an archived key's is free) is chosen.
    const colours = screen.getByRole('group', { name: 'Colour' });
    expect([...colours.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual([
      'Teal (Storefront uses it)',
      'Blue (Shop uses it)',
      'Rust',
      'Purple',
      'Berry',
      'Ochre',
      'Sky',
      'Moss',
    ]);
    expect(within(colours).getByRole('button', { name: 'Rust' }).getAttribute('aria-pressed')).toBe('true');
    // Relays and routes start from the original key; archived keys are not offered.
    const from = screen.getByRole('group', { name: 'Start its relays and routes from' });
    expect([...from.querySelectorAll('input')].map((i) => [i.value, i.checked])).toEqual([
      ['invoices', true],
      ['shop', false],
      ['', false],
    ]);
    await t.create();
    await waitFor(() =>
      expect(t.addInvoiceKey).toHaveBeenCalledWith({ id: 'bread-club', label: 'Bread club', color: 2, public_invoicing: true, announce: false, copy_from: 'invoices' }),
    );
    expect(t.onAdded).toHaveBeenCalledWith(invoiceKeyList(), 'bread-club');
  });

  it('sends every choice', async () => {
    const t = setup();
    await fireEvent.input(t.id, { target: { value: 'club' } });
    await fireEvent.input(t.name, { target: { value: ' Bread club ' } });
    expect(t.id.value).toBe('club');
    await fireEvent.input(screen.getByLabelText(/What it is for/), { target: { value: ' Monthly box ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Purple' }));
    await fireEvent.click(screen.getByRole('radio', { name: /Shop/ }));
    expect(screen.getByRole('radio', { name: /Shop/ }).closest('label')!.className).toContain('on');
    await fireEvent.click(screen.getByRole('radio', { name: /Every relay/ }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /Anyone may create invoices/ }));
    await fireEvent.click(screen.getByRole('checkbox', { name: /Announce it/ }));
    await t.create();
    await waitFor(() =>
      expect(t.addInvoiceKey).toHaveBeenCalledWith({ id: 'club', label: 'Bread club', description: 'Monthly box', color: 3, public_invoicing: false, announce: true, copy_from: '' }),
    );
  });

  it('checks the name and id first, and shows what the service says', async () => {
    const t = setup(vi.fn().mockRejectedValue(new Error('label must be 1 to 40 visible characters')));
    await t.create();
    expect(screen.getByRole('alert').textContent).toBe('Give the key a name.');
    await fireEvent.input(t.name, { target: { value: 'Shop' } });
    await t.create();
    expect(screen.getByRole('alert').textContent).toBe('There is already a key called shop.');
    expect(t.id.getAttribute('aria-invalid')).toBe('true');
    await fireEvent.input(t.id, { target: { value: '9' } });
    expect(screen.getByRole('alert').textContent).toMatch(/^Use 2 to 24/);
    expect(t.addInvoiceKey).not.toHaveBeenCalled();
    await fireEvent.input(t.id, { target: { value: 'shop-2' } });
    await t.create();
    expect((await screen.findByRole('alert')).textContent).toBe('label must be 1 to 40 visible characters');
    expect(t.onAdded).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Keys' }));
    expect(t.onCancel).toHaveBeenCalledTimes(2);
  });
});
