import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import KeyChips from './KeyChips.svelte';
import KeyBadges from './KeyBadges.svelte';
import { keyInfos } from '../test-helpers';
import { KEY_COLORS } from '../lib/keys';

describe('KeyChips', () => {
  it('shows one switch per key, all on for an empty assignment, and reports a change', async () => {
    const onchange = vi.fn();
    render(KeyChips, { props: { keys: keyInfos(), assigned: [], label: 'Relay', onchange } });
    expect((screen.getByLabelText('Relay used by Administration') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('all keys')).toBeTruthy();
    await fireEvent.click(screen.getByLabelText('Relay used by Administration'));
    expect(onchange).toHaveBeenCalledWith('admin', false);
  });

  it('keeps the last key switched on and can be disabled as a whole', () => {
    render(KeyChips, { props: { keys: keyInfos(), assigned: ['invoices'], label: 'Relay', onchange: vi.fn() } });
    expect((screen.getByLabelText('Relay used by Public invoices') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Relay used by Administration') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByText('all keys')).toBeNull();
    document.body.innerHTML = '';
    render(KeyChips, { props: { keys: keyInfos(), assigned: [], label: 'Relay', onchange: vi.fn(), disabled: true } });
    expect((screen.getByLabelText('Relay used by Administration') as HTMLInputElement).disabled).toBe(true);
  });

  it('pins a required key on and says why on hover', () => {
    render(KeyChips, { props: { keys: keyInfos(), assigned: [], label: 'Relay', onchange: vi.fn(), required: ['admin'], requiredWhy: 'this page connects through it' } });
    const admin = screen.getByLabelText('Relay used by Administration') as HTMLInputElement;
    expect(admin.disabled).toBe(true);
    expect(admin.closest('label')?.getAttribute('title')).toBe('Administration: this page connects through it');
    expect(admin.closest('label')?.classList.contains('pinned')).toBe(true);
    const invoices = screen.getByLabelText('Relay used by Public invoices') as HTMLInputElement;
    expect(invoices.disabled).toBe(false);
    expect(invoices.closest('label')?.hasAttribute('title')).toBe(false);
  });

  it('is not shown while there is only one key', () => {
    render(KeyChips, { props: { keys: keyInfos().slice(0, 1), assigned: [], label: 'Relay', onchange: vi.fn() } });
    expect(screen.queryByRole('group')).toBeNull();
  });
});

describe('KeyBadges', () => {
  it('names the keys only when not every key uses the thing', () => {
    const { container, rerender } = render(KeyBadges, { props: { keys: ['invoices'], total: 2, all: keyInfos() } });
    expect(container.textContent).toBe('Public invoices');
    expect(container.querySelector('.badge.key')!.classList.contains('kc0')).toBe(true);
    rerender({ keys: ['invoices', 'admin'], total: 2 });
    expect(container.textContent).toBe('');
    rerender({ keys: [], total: 2 });
    expect(container.textContent).toBe('');
  });

  it('falls back to the id without the list of keys', () => {
    const { container } = render(KeyBadges, { props: { keys: ['admin'], total: 2 } });
    expect(container.textContent).toBe('admin');
    expect(container.querySelector('.badge.key')!.classList.contains('kc-admin')).toBe(true);
  });

  it('takes stored colours from the page', () => {
    const { container } = render(KeyBadges, { props: { keys: ['invoices'], total: 2, all: keyInfos() }, context: new Map([[KEY_COLORS, { invoices: 4 }]]) });
    expect(container.querySelector('.badge.key')!.classList.contains('kc4')).toBe(true);
  });
});
