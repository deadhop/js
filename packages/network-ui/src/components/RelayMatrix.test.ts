// Relays × keys: a column per key, the same switching rules as the chips,
// counts per key and a button that gives a key every relay.
import { describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import RelayMatrix from './RelayMatrix.svelte';
import KeyLegend from './KeyLegend.svelte';
import { fourKeys, keyInfos, settings } from '../test-helpers';
import { KEY_COLORS } from '../lib/keys';
import type { KeyInfo, NetworkSettings } from '../lib/schemas';

const A = 'wss://a.example';
const B = 'wss://b.example';
const DASH = 'ws://127.0.0.1:7777';

const cell = (what: string) => createRawSnippet((r: () => string) => ({ render: () => `<span>${what} ${r()}</span>` }));

function setup(keys: KeyInfo[], relayKeys: NetworkSettings['relay_keys'], open: string | null = null) {
  const onuse = vi.fn();
  const view = render(RelayMatrix, {
    props: { keys, relays: [DASH, A, B], relayKeys, dashboardRelays: [DASH], onuse, relay: cell('relay'), route: cell('route'), panel: cell('panel'), panelOpen: (r: string) => r === open },
  });
  return { onuse, ...view };
}

const box = (relay: string, key: string) => screen.getByLabelText(`${relay} used by ${key}`) as HTMLInputElement;
const foot = (row: string) => [...screen.getByRole('rowheader', { name: row }).closest('tr')!.querySelectorAll('td')].map((td) => td.textContent!.trim());

describe('RelayMatrix', () => {
  it('has a column per key, the administration key first, and the invoice keys grouped', () => {
    setup(fourKeys(), {});
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent!.trim());
    expect(heads).toEqual(['', 'Operators', 'Invoice keys', '', 'Relay', 'Administration', 'Storefront', 'Catering orders', 'Oven fund', 'Route']);
    expect(screen.getByText('relay wss://a.example')).toBeTruthy();
    expect(screen.getByText('route wss://b.example')).toBeTruthy();
    expect(screen.queryByText(/^panel/)).toBeNull();
    // Each key keeps its colour; the administration key is graphite.
    expect(screen.getAllByRole('columnheader').flatMap((h) => [...h.querySelectorAll('.key-tag')].map((t) => t.className.replace('key-tag ', '').trim()))).toEqual(['kc-admin', 'kc0', 'kc1', 'kc2']);
  });

  it('switches one key on or off for a relay', async () => {
    const t = setup(fourKeys(), { [A]: ['invoices', 'catering'] });
    expect(box(A, 'Oven fund').checked).toBe(false);
    await fireEvent.click(box(A, 'Oven fund'));
    expect(t.onuse).toHaveBeenCalledWith(A, 'oven', true);
    await fireEvent.click(box(B, 'Catering orders'));
    expect(t.onuse).toHaveBeenCalledWith(B, 'catering', false);
  });

  it('keeps on a key that depends on the relay, and a relay’s last key, saying why on hover', () => {
    setup(fourKeys(), { [A]: ['oven'], [B]: ['admin', 'invoices', 'oven'], [DASH]: ['admin', 'invoices', 'catering'] });
    // Oven fund is A's only key; the administration key has only DASH among this page's relays.
    const oven = box(A, 'Oven fund');
    expect(oven.disabled).toBe(true);
    expect(oven.closest('label')!.title).toBe("Oven fund: the relay's last key. Remove the relay instead.");
    const admin = box(DASH, 'Administration');
    expect(admin.disabled).toBe(true);
    expect(admin.closest('label')!.classList.contains('pinned')).toBe(true);
    expect(admin.closest('label')!.title).toBe('Administration: its only relay, or the only one this page connects through, so it stays on.');
    const free = box(B, 'Storefront');
    expect(free.disabled).toBe(false);
    expect(free.closest('label')!.hasAttribute('title')).toBe(false);
  });

  it('counts the relays per key, flags a key with one or none, and gives a key every relay', async () => {
    const t = setup(fourKeys(), { [A]: ['oven', 'invoices'], [B]: ['admin', 'invoices'], [DASH]: ['admin', 'invoices', 'catering'] });
    expect(foot('Relays per key')).toEqual(['2', '3', '1 · add another', '1 · add another', '']);
    const all = within(screen.getByRole('rowheader', { name: 'Whole column' }).closest('tr')!).getAllByRole('button', { name: /^Use every relay for/ }) as HTMLButtonElement[];
    expect(all.map((b) => b.disabled)).toEqual([false, true, false, false]);
    await fireEvent.click(screen.getByRole('button', { name: 'Use every relay for Oven fund' }));
    expect(t.onuse.mock.calls).toEqual([
      [DASH, 'oven', true],
      [B, 'oven', true],
    ]);
  });

  it('flags a key with no relay', () => {
    setup(fourKeys(), { [A]: ['invoices'], [B]: ['invoices'], [DASH]: ['invoices', 'admin'] });
    expect(foot('Relays per key')).toEqual(['1 · add another', '3', '0 · add one', '0 · add one', '']);
  });

  it('opens a panel under a relay across the whole row', () => {
    setup(fourKeys(), {}, A);
    const panel = screen.getByText('panel wss://a.example').closest('td')!;
    expect(panel.getAttribute('colspan')).toBe('6');
  });

  it('works the same with two keys', () => {
    setup(keyInfos(), {}, A);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent!.trim())).toEqual(['', 'Operators', 'Invoice keys', '', 'Relay', 'Administration', 'Public invoices', 'Route']);
    expect(screen.getByText('panel wss://a.example').closest('td')!.getAttribute('colspan')).toBe('4');
  });

  it('shows only the relays with a single key, or only invoice keys', () => {
    setup(keyInfos().slice(0, 1), {}, A);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent!.trim())).toEqual(['Relay', 'Route']);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Relays per key')).toBeNull();
    expect(screen.getByText('panel wss://a.example').closest('td')!.getAttribute('colspan')).toBe('2');
    document.body.innerHTML = '';
    // Without an operators' key there is no Operators group (and no gap before the invoice keys).
    setup([fourKeys()[0], fourKeys()[1]], {});
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent!.trim())).toEqual(['', 'Invoice keys', '', 'Relay', 'Storefront', 'Catering orders', 'Route']);
    document.body.innerHTML = '';
    // Only the operators' keys: no Invoice keys group.
    setup([keyInfos()[1], { ...keyInfos()[1], id: 'ops', label: 'Ops' }], {});
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent!.trim())).toEqual(['', 'Operators', '', 'Relay', 'Administration', 'Ops', 'Route']);
  });
});

describe('KeyLegend', () => {
  it('says per key what it is for, how many relays it uses and where everything else goes', () => {
    const form = settings({
      relays: [A, B],
      relay_keys: { [B]: ['invoices', 'admin'] },
      proxies: { ...settings().proxies, list: [{ id: 'tor', name: 'Tor', url: 'socks5://tor:1' }], default: { proxy: 'tor' }, default_keys: { oven: 'direct' } },
    });
    render(KeyLegend, { props: { keys: fourKeys(), form, purposes: { catering: 'Catering site.' } }, context: new Map([[KEY_COLORS, { oven: 6 }]]) });
    const items = within(screen.getByRole('list', { name: 'Keys' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent!.replace(/\s+/g, ' ').trim())).toEqual([
      'Administration Operators sign in here. 2 relays · everything else: tor',
      'Storefront Customers and apps create invoices here. 2 relays · everything else: tor',
      'Catering orders Catering site. 1 relay · everything else: tor',
      'Oven fund Customers and apps create invoices here. 1 relay · everything else: direct, no proxy',
    ]);
    expect(items[2].querySelector('.few')).not.toBeNull();
    expect(items[1].querySelector('.few')).toBeNull();
    expect(items[3].querySelector('.key-tag')!.classList.contains('kc6')).toBe(true);
  });

  it('says what each key is for in general words when not told', () => {
    render(KeyLegend, { props: { keys: keyInfos(), form: settings() } });
    expect(screen.getByRole('list', { name: 'Keys' }).textContent).toContain('Customers and apps create invoices here.');
  });
});
