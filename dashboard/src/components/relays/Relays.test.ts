import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import Relays from './Relays.svelte';
import { health, keyInfosWithShop, relayHistory, relayStats } from '../../test-helpers';
import type { Health, RelayHealth, RelayHistory } from '../../lib/schemas';

afterEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
});

const check = (relay: string, over: Partial<RelayHealth> = {}): RelayHealth => ({
  relay, status: 'ok', connects: true, forwards: true, rate_limited: false, ms: 84, detail: '', checked_at: 1_700_000_000, ...over,
});

const ONION = 'ws://paresiah7gsmksmsmisnrd5ujfyay4u4daq6wrkyo3qdltfs6rcyywyd.onion/';

// Four relays: one every key uses, a slow and failing one, a degraded onion, one gone.
function sample(): { health: Health; history: RelayHistory } {
  return {
    health: health({
      keys: keyInfosWithShop(),
      relays: [
        { url: 'wss://all.example', status: 'connected', connected: true, keys: ['admin', 'invoices', 'shop'] },
        { url: 'wss://slow.example', status: 'connected', connected: true, keys: ['invoices', 'shop'] },
        { url: ONION, status: 'connected', connected: true, keys: ['invoices', 'shop'] },
        { url: 'wss://gone.example', status: 'disconnected', connected: false, keys: ['admin'] },
      ],
      relay_health: [check('wss://all.example'), check('wss://slow.example', { ms: 1958 }), check(ONION, { status: 'degraded', ms: null, detail: 'The relay is rate-limiting us.' })],
    }),
    history: relayHistory({
      relays: [
        relayStats({ relay: 'wss://all.example', checks: 100, check_failures: 0, sends: 100, send_failures: 1 }),
        relayStats({ relay: 'wss://slow.example', checks: 50, check_failures: 13, sends: 0, send_failures: 0 }),
      ],
    }),
  };
}

function show(over: Partial<{ health: Health; history: RelayHistory | null; checking: boolean }> = {}) {
  const props = { ...sample(), checking: false, oncheck: vi.fn(), onConnectivity: vi.fn(), ...over };
  render(Relays, { props });
  return props;
}

const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
const pickView = (value: string) => fireEvent.change(screen.getByLabelText('View'), { target: { value } });

describe('the Relays card', () => {
  it('shows columns by default, with the actions in its head', async () => {
    const p = show();
    expect((screen.getByLabelText('View') as HTMLSelectElement).value).toBe('columns');
    const rows = [...document.querySelectorAll('.relay-columns tbody tr')];
    expect(rows.map((tr) => [...tr.querySelectorAll('td')].map(text))).toEqual([
      ['all.example wss://all.example, connected', 'Clearnet', 'Administration, Public invoices and ShopAll keys', '84 ms', '', '0.5%'],
      ['slow.example wss://slow.example, connected', 'Clearnet', 'Public invoices and Shop2 keys, not Administration', '1,958 ms', '', '26%'],
      [`paresiah7gsm…fs6rcyywyd.onion ${ONION}, connected The relay is rate-limiting us.`, 'Tor', 'Public invoices and Shop2 keys, not Administration', '—', '', ''],
      ['gone.example wss://gone.example, disconnected not checked yet', 'Clearnet', 'AdministrationAdministration', 'disconnected', '', ''],
    ]);
    expect(rows[0].querySelector('.rate-chip')!.className).toBe('rate-chip quiet');
    expect(rows[1].querySelector('.relay-ms')!.className).toContain('slow');
    expect(rows[1].querySelector('.rate-chip')!.className).toBe('rate-chip bad');
    expect(rows[0].querySelector('svg.bars')).not.toBeNull();
    expect(rows[2].querySelector('.bars-none')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(p.oncheck).toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Connectivity' }));
    expect(p.onConnectivity).toHaveBeenCalled();
  });

  it('says it is checking while a check runs', () => {
    show({ checking: true });
    expect((screen.getByRole('button', { name: 'Checking…' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('remembers the view picked in this browser', async () => {
    show();
    await pickView('coverage');
    expect(localStorage.getItem('deadhop.relay-view')).toBe('coverage');
    document.body.innerHTML = '';
    show();
    expect((screen.getByLabelText('View') as HTMLSelectElement).value).toBe('coverage');
    expect(document.querySelector('.relay-coverage')).not.toBeNull();
  });

  it('shows two lines per relay, naming the keys of a relay not every key uses', async () => {
    show();
    await pickView('rows');
    const items = [...document.querySelectorAll('.relay-rows li')];
    expect(items.map((li) => text(li.querySelector('.relay-sub')))).toEqual(['All keys', 'Public invoicesShop', 'Public invoicesShop The relay is rate-limiting us.', 'Administration not checked yet']);
    expect(items.map((li) => li.querySelector('.net-tag')!.textContent)).toEqual(['Clearnet', 'Clearnet', 'Tor', 'Clearnet']);
    expect(items[1].querySelector('.rate-chip')!.textContent).toBe('26% errors');
  });

  it('groups the relays by the keys they serve, with how many of each group are connected', async () => {
    show();
    await pickView('groups');
    const groups = [...document.querySelectorAll('.relay-group')];
    expect(groups.map((g) => [g.querySelector('h3')!.textContent, g.querySelector('.key-names')?.textContent ?? '', g.querySelector('.group-health')!.textContent, g.querySelectorAll('li').length])).toEqual([
      ['All keys', '', '1 of 1 connected', 1],
      ['2 keys', 'Public invoicesShop', '2 of 2 connected', 2],
      ['Administration only', '', '0 of 1 connected', 1],
    ]);
    expect(groups.map((g) => g.querySelector('.group-health')!.className)).toEqual(['group-health ok', 'group-health ok', 'group-health bad']);
    expect(groups[1].querySelector('.relay-note')!.textContent).toBe('The relay is rate-limiting us.');
    document.body.innerHTML = '';
    const relays = [
      { url: 'wss://a.example', status: 'connected', connected: true, keys: ['admin', 'invoices'] },
      { url: 'wss://b.example', status: 'connecting', connected: false, keys: ['admin', 'invoices'] },
    ];
    show({ health: health({ relays }), history: null });
    expect(text(document.querySelector('.group-health'))).toBe('1 of 2 connected');
    expect(document.querySelector('.group-health')!.className).toBe('group-health warn');
  });

  it('puts the relays that need a look first, and the rest in tiles', async () => {
    show();
    await pickView('problems');
    const summary = [...document.querySelectorAll('.relay-summary > div')].map((d) => [d.querySelector('.lbl')!.textContent, d.querySelector('.big')!.textContent, d.querySelector('.big')!.className]);
    expect(summary).toEqual([
      ['Connected', '3 of 4', 'big warn'],
      ['Keys with a relay', '3 of 3', 'big ok'],
      ['Need a look', '3', 'big warn'],
    ]);
    const problems = [...document.querySelectorAll('.relay-problems li')];
    expect(problems.map((li) => text(li.querySelector('.muted')))).toEqual(['2 keys, not Administration · 1,958 ms · 26% errors', '2 keys, not Administration · —', 'Administration · disconnected']);
    expect(problems.map((li) => li.className)).toEqual(['tone-ok', 'tone-warn', 'tone-bad']);
    expect(problems[0].querySelector('.bars-wide svg.bars')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Working well · 1' })).toBeTruthy();
    expect(text(document.querySelector('.relay-tiles li .tile-figures'))).toBe('84 ms 0.5%');
  });

  it('says when nothing needs a look, and leaves the tiles out when nothing works', async () => {
    show({ health: health(), history: null });
    await pickView('problems');
    expect(screen.getByText('Nothing needs a look.')).toBeTruthy();
    expect(document.querySelector('.relay-tiles li .bars-none')).not.toBeNull();
    document.body.innerHTML = '';
    show({ health: health({ relays: [{ url: 'wss://gone.example', status: 'disconnected', connected: false, keys: ['admin', 'invoices'] }] }), history: null });
    expect(document.querySelectorAll('.relay-summary .big.bad')).toHaveLength(2);
    expect(screen.queryByRole('heading', { name: /Working well/ })).toBeNull();
  });

  it('shows which relay carries which key, and each key’s connected relays', async () => {
    show();
    await pickView('coverage');
    const table = screen.getByRole('table');
    expect([...table.querySelectorAll('thead th.key-col')].map((th) => th.textContent)).toEqual(['Administration', 'Public invoices', 'Shop']);
    const cells = [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('i.cov')].map((i) => (i.classList.contains('off') ? '·' : '■')).join(''));
    expect(cells).toEqual(['■■■', '·■■', '·■■', '■··']);
    expect(within(table).getAllByText('does not use it')).toHaveLength(4);
    const foot = [...table.querySelectorAll('tfoot td.key-col')].map((td) => [td.textContent, td.className]);
    expect(foot).toEqual([
      ['1 of 2', 'key-col mono warn'],
      ['3 of 3', 'key-col mono ok'],
      ['3 of 3', 'key-col mono ok'],
    ]);
  });
});
