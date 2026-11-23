import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import ProxyPool from './ProxyPool.svelte';
import type { NetworkApi } from '../lib/network-api';
import type { ProxyEntry, ProxyPool as Pool, ProxySettings, Rule } from '../lib/schemas';
import { activePool, keyInfos, proxyCheck, proxyPool, settings } from '../test-helpers';

const entry = (id: string, url: string, name = '', over: Partial<ProxyEntry> = {}): ProxyEntry => ({ id, name, url, keys: [], pool: true, ...over });
const TWO = () => [entry('a', 'socks5://me:***@10.0.0.1:1080', 'tor'), entry('b', 'http://10.0.0.2:3128')];
const status = (e: ProxyEntry, over: Partial<Pool['proxies'][number]> = {}): Pool['proxies'][number] => ({
  id: e.id, name: e.name, url: e.url, reachable: true, checked_at: 1_700_000_050, status: 'connected', reason: null, keys: e.keys, pool: e.pool, ...over,
});
const lane = (key: string, active: string | null, state: Pool['state'] = 'active') => ({ key, state, active, reachable: 1, next_switch_at: null, uses_default: true });
const i2pRule = (to: Rule['to']): Rule => ({ name: '', match: ['*.i2p'], keys: [], to, fallback: 'offline' });

function setup(over: Partial<ProxySettings> = {}, opts: { pool?: Pool | null; locked?: boolean; live?: ProxySettings } = {}) {
  // The form settings the parent hands over are deeply reactive, and the view changes them in place.
  const proxies: ProxySettings = $state({ ...settings().proxies, ...over });
  const live = opts.live ?? { ...settings().proxies, ...over, list: [...(over.list ?? [])] };
  const api = { checkProxy: vi.fn().mockResolvedValue(proxyCheck()) };
  render(ProxyPool, { props: { api: api as unknown as NetworkApi, keys: keyInfos(), proxies, live, pool: opts.pool ?? null, locked: opts.locked ?? false } });
  return { api, proxies };
}

const rows = () => [...document.querySelectorAll('li.proxy-row')];
const names = () => rows().map((r) => r.querySelector('.proxy-name')!.textContent);
const ids = (p: ProxySettings) => p.list.map((e) => e.id);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const stateLine = () => document.querySelector('.strategy-state')?.textContent ?? null;
const laneLines = () => [...(screen.queryByRole('list', { name: 'Proxy in use, per key' })?.querySelectorAll('li') ?? [])].map((li) => li.textContent);

afterEach(() => vi.useRealTimers());

describe('the proxy list', () => {
  it('starts empty, and creates a proxy as a new entry', async () => {
    const { proxies } = setup();
    expect(screen.getByText('0 of 8')).toBeTruthy();
    expect(screen.getByText('No proxies. Relays connect straight to this machine.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
    await fireEvent.click(button('Create proxy'));
    expect(screen.getByRole('group', { name: 'Create proxy' })).toBeTruthy();
    expect((screen.getByLabelText('Host') as HTMLInputElement).value).toBe('127.0.0.1');
    expect((screen.getByLabelText('Password') as HTMLInputElement).placeholder).toBe('');
    await fireEvent.input(screen.getByLabelText('Label (optional)'), { target: { value: ' Tor ' } });
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '' } });
    await fireEvent.click(button('Add to list'));
    expect(screen.getByRole('alert').textContent).toBe('Enter a proxy port between 1 and 65535.');
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '9050' } });
    await fireEvent.input(screen.getByLabelText('User name'), { target: { value: 'me' } });
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    await fireEvent.click(button('Add to list'));
    expect(proxies.list).toHaveLength(1);
    expect(proxies.list[0]).toMatchObject({ name: 'Tor', url: 'socks5://me:pw@127.0.0.1:9050', keys: [], pool: true, i2p: false });
    expect(proxies.list[0].id).toMatch(/^new:/);
    expect(screen.getByText('socks5://me:pw@127.0.0.1:9050')).toBeTruthy();
    expect(screen.getByText('not saved')).toBeTruthy();
    expect(screen.getByText('1 of 8')).toBeTruthy();
    expect(screen.queryByLabelText('Host')).toBeNull();
  });

  it('refuses the same address twice, and can cancel', async () => {
    const { proxies } = setup({ list: [entry('b', 'http://10.0.0.2:3128')] });
    await fireEvent.click(button('Create proxy'));
    await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'http' } });
    await fireEvent.input(screen.getByLabelText('Host'), { target: { value: '10.0.0.2' } });
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '3128' } });
    await fireEvent.click(button('Add to list'));
    expect(screen.getByRole('alert').textContent).toBe('That proxy is already listed.');
    await fireEvent.click(button('Cancel'));
    expect(screen.queryByLabelText('Host')).toBeNull();
    expect(ids(proxies)).toEqual(['b']);
  });

  it('edits a proxy, keeping a hidden password unless the address changes', async () => {
    const { proxies } = setup({ list: TWO() });
    await fireEvent.click(button('Edit proxy 1'));
    expect(screen.getByRole('group', { name: 'Edit proxy 1' })).toBeTruthy();
    expect((screen.getByLabelText('Password') as HTMLInputElement).placeholder).toBe('unchanged');
    await fireEvent.input(screen.getByLabelText('Label (optional)'), { target: { value: 'onion' } });
    await fireEvent.click(button('Update proxy'));
    expect(proxies.list[0]).toEqual({ id: 'a', name: 'onion', url: 'socks5://me:***@10.0.0.1:1080', keys: [], pool: true, i2p: false });

    await fireEvent.click(button('Edit proxy 1'));
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '9150' } });
    await fireEvent.click(button('Update proxy'));
    expect(screen.getByRole('alert').textContent).toBe('Re-enter the proxy password to change the proxy.');
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'new' } });
    await fireEvent.click(button('Update proxy'));
    expect(proxies.list[0].url).toBe('socks5://me:new@10.0.0.1:9150');
    // Its own address is not a duplicate of itself.
    await fireEvent.click(button('Edit proxy 2'));
    await fireEvent.click(button('Update proxy'));
    expect(proxies.list[1].url).toBe('http://10.0.0.2:3128');
  });

  it('caps the list at eight', () => {
    setup({ list: Array.from({ length: 8 }, (_, i) => entry(`p${i}`, `socks5://10.0.0.${i + 1}:1080`)) });
    expect((button('Create proxy') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Eight proxies is the most.')).toBeTruthy();
  });

  it('moves a proxy with the arrow buttons, which stop at the ends', async () => {
    const { proxies } = setup({ list: TWO() });
    expect(names()).toEqual(['tor', 'Unnamed proxy']);
    expect((button('Move proxy 1 up') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Move proxy 2 down') as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(button('Move proxy 2 up'));
    expect(ids(proxies)).toEqual(['b', 'a']);
    expect(names()).toEqual(['Unnamed proxy', 'tor']);
    await fireEvent.click(button('Move proxy 1 down'));
    expect(ids(proxies)).toEqual(['a', 'b']);
  });

  it('moves a proxy by dragging its handle, showing where it would land', async () => {
    const { proxies } = setup({ list: [...TWO(), entry('c', 'socks5://10.0.0.3:9050', 'third')] });
    const grips = () => screen.getAllByLabelText(/^Drag to reorder proxy/);
    const set = vi.fn();
    await fireEvent.dragStart(grips()[0], { dataTransfer: { setData: set } });
    expect(set).toHaveBeenCalledWith('text/plain', '0');
    expect(rows()[0].className).toContain('dragging');
    await fireEvent.dragOver(rows()[2]);
    expect(rows()[2].className).toContain('drop-target');
    await fireEvent.dragOver(rows()[0]);
    expect(rows()[0].className).not.toContain('drop-target');
    await fireEvent.dragOver(rows()[2]);
    await fireEvent.drop(rows()[2]);
    expect(ids(proxies)).toEqual(['b', 'c', 'a']);
    expect(rows().some((r) => r.className.includes('dragging'))).toBe(false);
    // A drop with nothing being dragged does nothing; a drag can be abandoned.
    await fireEvent.drop(rows()[0]);
    expect(ids(proxies)).toEqual(['b', 'c', 'a']);
    await fireEvent.dragStart(grips()[1]);
    expect(rows()[1].className).toContain('dragging');
    await fireEvent.dragEnd(grips()[1]);
    expect(rows()[1].className).not.toContain('dragging');
    expect(ids(proxies)).toEqual(['b', 'c', 'a']);
  });

  it('moves a proxy with the arrow keys on its handle, and ignores other keys', async () => {
    const { proxies } = setup({ list: TWO() });
    await fireEvent.keyDown(screen.getByLabelText('Drag to reorder proxy 1'), { key: 'ArrowDown' });
    expect(ids(proxies)).toEqual(['b', 'a']);
    await fireEvent.keyDown(screen.getByLabelText('Drag to reorder proxy 2'), { key: 'ArrowUp' });
    expect(ids(proxies)).toEqual(['a', 'b']);
    await fireEvent.keyDown(screen.getByLabelText('Drag to reorder proxy 1'), { key: 'ArrowUp' });
    await fireEvent.keyDown(screen.getByLabelText('Drag to reorder proxy 1'), { key: 'Tab' });
    expect(ids(proxies)).toEqual(['a', 'b']);
  });

  it('removes a proxy, closing the form, and drops reordering once one is left', async () => {
    const { proxies } = setup({ list: TWO() });
    await fireEvent.click(button('Edit proxy 2'));
    await fireEvent.click(button('Remove proxy 1'));
    expect(screen.queryByLabelText('Host')).toBeNull();
    expect(ids(proxies)).toEqual(['b']);
    expect(screen.queryByLabelText(/^Drag to reorder proxy/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move proxy 1 up' })).toBeNull();
  });

  it('takes a proxy out of the default route, and chooses which keys use it', async () => {
    const { proxies } = setup({ list: TWO() });
    await fireEvent.click(screen.getByLabelText('Proxy 1 in the default route'));
    expect(proxies.list[0].pool).toBe(false);
    expect(within(rows()[0] as HTMLElement).getByText('rules only')).toBeTruthy();
    expect(within(rows()[0] as HTMLElement).getByText('Used only by rules that name it.')).toBeTruthy();
    expect(screen.getByText(/^Every relay that no rule in Rules names goes through the proxies ticked .In the default route. above\.$/)).toBeTruthy();
    await fireEvent.click(screen.getByLabelText('Proxy 2 in the default route'));
    expect(screen.getByText(/None is ticked, so those relays stay offline\./)).toBeTruthy();

    await fireEvent.click(screen.getByLabelText('Proxy 2 in the default route'));
    expect((screen.getByLabelText('Proxy 2 used by Administration') as HTMLInputElement).checked).toBe(true);
    await fireEvent.click(screen.getByLabelText('Proxy 2 used by Administration'));
    expect(proxies.list[1].keys).toEqual(['invoices']);
    expect(proxies.list[0].keys).toEqual([]);
  });

  it('says what each proxy carries and which rules point at it', () => {
    const list = [entry('a', 'socks5://10.0.0.1:1080', 'tor'), entry('b', 'http://10.0.0.2:3128'), entry('c', 'socks5://10.0.0.3:1080')];
    const route = (relay: string, p: string) => ({ key: 'invoices', relay, rule: null, via: 'proxy' as const, proxy: p, reason: 'default' as const });
    const rule = (to: Rule['to']): Rule => ({ name: '', match: ['wss://x'], keys: [], to, fallback: 'offline' });
    setup(
      { list, rules: [rule({ proxy: 'b' }), rule('direct'), rule({ proxy: 'b' }), rule({ proxy: 'c' })] },
      { pool: activePool({ active: 'a', routes: [route('wss://one', 'a'), route('wss://one', 'a'), route('wss://two', 'b'), route('wss://three', 'b')] }) },
    );
    const carries = rows().map((r) => r.querySelector('.proxy-routes .hint')!.textContent);
    expect(carries).toEqual(['Carries 1 relay now', 'Carries 2 relays now · rules 1, 3 point here', 'Carries 0 relays now · rule 4 points here']);
  });

  it('without a status from the service, carries nothing and is not checked', () => {
    setup({ list: TWO() });
    expect(rows().map((r) => r.querySelector('.proxy-routes .hint')!.textContent)).toEqual(['Carries 0 relays now', 'Carries 0 relays now']);
    expect(screen.getAllByText('not checked')).toHaveLength(2);
  });

  it('shows how each proxy is doing, and which one is in use', () => {
    const list = [...TWO(), entry('c', 'socks5://10.0.0.3:1'), entry('d', 'socks5://10.0.0.4:1'), entry('e', 'socks5://10.0.0.5:1')];
    const pool = activePool({
      active: 'a',
      total: 4,
      proxies: [
        status(list[0]),
        status(list[1], { reachable: false, status: 'failed', reason: 'Nothing is listening at 10.0.0.2:3128.' }),
        status(list[2], { reachable: null, checked_at: null, status: null }),
        status(list[3], { reachable: false, status: 'failed', reason: null }),
      ],
    });
    setup({ list }, { pool });
    const state = (i: number) => rows()[i].querySelector('.proxy-state') as HTMLElement;
    const said = (i: number) => state(i).textContent!.trim();
    expect(said(0)).toBe('in use reachable');
    expect(within(state(0)).getByText('reachable').className).toBe('badge pass');
    const fail = within(state(1)).getByText('unreachable');
    expect(fail.className).toBe('badge fail');
    expect(fail.getAttribute('title')).toBe('Nothing is listening at 10.0.0.2:3128.');
    expect(rows()[1].querySelector('.proxy-reason')!.textContent).toBe('Nothing is listening at 10.0.0.2:3128.');
    expect(said(2)).toBe('not checked');
    // A failure with no reason given still shows as unreachable, with no reason line.
    expect(within(state(3)).getByText('unreachable').getAttribute('title')).toBe('');
    expect(rows()[3].querySelector('.proxy-reason')).toBeNull();
    // One the service has not heard of yet.
    expect(said(4)).toBe('not checked');
  });

  it('tests a saved proxy by id, and a changed or new one by its address', async () => {
    const list = TWO();
    const { api } = setup({ list }, { live: { ...settings().proxies, list: [list[0], { ...list[1], url: 'http://10.0.0.9:3128' }] } });
    let answer!: (v: unknown) => void;
    api.checkProxy.mockReturnValueOnce(new Promise((r) => (answer = r)));
    await fireEvent.click(button('Test proxy 1'));
    expect(api.checkProxy).toHaveBeenLastCalledWith({ id: 'a' });
    expect(button('Test proxy 1').textContent).toBe('Testing…');
    expect((button('Test proxy 1') as HTMLButtonElement).disabled).toBe(true);
    answer(proxyCheck());
    expect(await screen.findByText('Connected')).toBeTruthy();
    expect(button('Test proxy 1').textContent).toBe('Test');

    // Saved, but its address changed in the form.
    api.checkProxy.mockRejectedValueOnce(new Error('rate limit exceeded'));
    await fireEvent.click(button('Test proxy 2'));
    expect(api.checkProxy).toHaveBeenLastCalledWith('http://10.0.0.2:3128');
    expect(await screen.findByText('rate limit exceeded')).toBeTruthy();

    await fireEvent.click(button('Create proxy'));
    await fireEvent.input(screen.getByLabelText('Host'), { target: { value: '10.9.9.9' } });
    await fireEvent.click(button('Add to list'));
    await fireEvent.click(button('Test proxy 3'));
    expect(api.checkProxy).toHaveBeenLastCalledWith('socks5://10.9.9.9:9050');
  });
});

describe('an I2P router', () => {
  it('is created with its usual port, outside the default route', async () => {
    const { proxies } = setup();
    await fireEvent.click(button('Create proxy'));
    await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'i2p' } });
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('4444');
    expect(screen.getByText(/Your I2P router's HTTP proxy, usually port 4444/)).toBeTruthy();
    // A port of its own is kept when switching back and forth.
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '4447' } });
    await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'http' } });
    expect(screen.queryByText(/Your I2P router's HTTP proxy/)).toBeNull();
    await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'i2p' } });
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('4447');
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '' } });
    await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'i2p' } });
    expect((screen.getByLabelText('Port') as HTMLInputElement).value).toBe('4444');
    await fireEvent.input(screen.getByLabelText('Label (optional)'), { target: { value: 'i2pd' } });
    await fireEvent.click(button('Add to list'));
    expect(proxies.list[0]).toMatchObject({ name: 'i2pd', url: 'http://127.0.0.1:4444', pool: false, i2p: true });
    expect(screen.getByText('I2P router').className).toBe('badge i2p-badge');
    // Not saved yet: no rule can name it.
    expect(screen.getByText('Save this proxy first. Then it can carry your .i2p relays.')).toBeTruthy();
    // Only one router: the choice is closed to a second proxy, not to the router itself.
    await fireEvent.click(button('Create proxy'));
    expect(screen.getByText('An I2P router is already listed. Only one can be.')).toBeTruthy();
    expect((screen.getByRole('option', { name: 'I2P router' }) as HTMLOptionElement).disabled).toBe(true);
    await fireEvent.click(button('Cancel'));
    await fireEvent.click(button('Edit proxy 1'));
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('i2p');
    expect((screen.getByRole('option', { name: 'I2P router' }) as HTMLOptionElement).disabled).toBe(false);
  });

  it('once saved, offers a rule that sends .i2p relays through it', async () => {
    const router = entry('r', 'http://127.0.0.1:4444', '', { pool: false, i2p: true });
    const { proxies } = setup({ list: [router] });
    expect(screen.getByText('http://127.0.0.1:4444 carries relays only when a rule sends them to it. Where .i2p names are looked up is under Settings.')).toBeTruthy();
    await fireEvent.click(button('Send .i2p relays through this proxy'));
    expect(proxies.rules).toEqual([i2pRule({ proxy: 'r' })]);
    expect(screen.getByText('Rule 1 decides where .i2p relays go: http://127.0.0.1:4444.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send .i2p relays through this proxy' })).toBeNull();
  });

  it('names the rule that already decides, and cannot add a seventeenth', () => {
    const other: Rule = { name: '', match: ['wss://x'], keys: [], to: 'direct', fallback: 'offline' };
    const router = entry('r', 'http://127.0.0.1:4444', 'i2pd', { pool: false, i2p: true });
    setup({ list: [router], rules: [other, i2pRule('block')] });
    expect(screen.getByText('Rule 2 decides where .i2p relays go: nowhere: blocked.')).toBeTruthy();
    document.body.innerHTML = '';
    setup({ list: [router], rules: Array.from({ length: 16 }, () => other) });
    expect((button('Send .i2p relays through this proxy') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the strategy', () => {
  it('is hidden with fewer than two proxies in the default route', () => {
    setup({ list: [TWO()[0]], mode: 'chaos' });
    expect(screen.queryByText('Strategy')).toBeNull();
    expect(screen.queryByLabelText('Round-robin')).toBeNull();
  });

  it('describes each mode and changes the intervals that belong to it', async () => {
    const { proxies } = setup({ list: TWO() });
    expect((screen.getByLabelText('Failover') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Use the first proxy in the list. If it is down, use the next one.')).toBeTruthy();
    expect(screen.getByText(/returns to an earlier proxy once it has stayed up for 2 minutes/)).toBeTruthy();
    expect(screen.queryByLabelText('Change proxy every')).toBeNull();

    await fireEvent.click(screen.getByLabelText('Round-robin'));
    expect(proxies.mode).toBe('round_robin');
    expect(screen.getByText(/not per connection/)).toBeTruthy();
    expect(screen.getByText(/Rotation needs two reachable proxies/)).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Change proxy every'), { target: { value: '30' } });
    await fireEvent.change(screen.getByLabelText('Change proxy every: unit'), { target: { value: 'm' } });
    expect(proxies.rotate_secs).toBe(1800);

    await fireEvent.click(screen.getByLabelText('Chaos'));
    expect(proxies.mode).toBe('chaos');
    expect(screen.queryByLabelText('Change proxy every')).toBeNull();
    expect(screen.getByText('A random time in between, now 5m to 15m.')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Longest time before a change'), { target: { value: '30' } });
    expect(proxies.chaos_max_secs).toBe(1800);
    await fireEvent.input(screen.getByLabelText('Shortest time before a change'), { target: { value: '10' } });
    expect(proxies.chaos_min_secs).toBe(600);
    expect(screen.getByText('A random time in between, now 10m to 30m.')).toBeTruthy();
  });

  it('can be off: only the first proxy for each key is used, and the others say so', async () => {
    const { proxies } = setup({ list: [...TWO(), entry('c', 'socks5://10.0.0.3:1080', 'rules', { pool: false })], mode: 'off' });
    expect((screen.getByLabelText('Off') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/never switch/)).toBeTruthy();
    expect(screen.queryByText(/Rotation needs two/)).toBeNull();
    expect(screen.queryByText(/returns to an earlier proxy/)).toBeNull();
    expect(rows().map((r) => r.querySelector('.proxy-routes .badge')?.textContent ?? '')).toEqual(['', 'not used: strategy off', 'rules only']);
    await fireEvent.click(screen.getByLabelText('Failover'));
    expect(proxies.mode).toBe('failover');
    expect(screen.queryByText('not used: strategy off')).toBeNull();
  });

  it('when off, counts a proxy as used if it is first for some key', () => {
    setup({ list: [entry('a', 'socks5://10.0.0.1:1080', 'tor', { keys: ['invoices'] }), entry('b', 'http://10.0.0.2:3128', 'vpn', { keys: ['admin'] })], mode: 'off' });
    expect(screen.queryByText('not used: strategy off')).toBeNull();
  });
});

describe('what the service is doing', () => {
  const one = status(entry('a', 'socks5://10.0.0.1:1080', 'tor'));
  const line = (pool: Pool, over: Partial<ProxySettings> = {}) => {
    document.body.innerHTML = '';
    setup({ list: TWO(), ...over }, { pool });
    return stateLine();
  };

  it('says it in one line', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    expect(line(activePool({ total: 2, active: 'b', next_switch_at: 1_700_000_720, proxies: [one, { ...one, id: 'b' }] }))).toBe('Active · proxy 2 of 2 · next switch in 12m');
    // A switch that is overdue is due now.
    expect(line(activePool({ total: 2, active: 'a', next_switch_at: 1_699_999_000, proxies: [one] }))).toBe('Active · proxy 1 of 2 · next switch in 0s');
    expect(line(activePool({ total: 2, active: null, proxies: [one] }))).toBe('Active · proxy 0 of 2');
    expect(line(proxyPool({ state: 'suspended', reachable: 1, total: 2, active: 'a', proxies: [one] }))).toBe(
      'Suspended: rotation needs 2 reachable proxies, 1 is. That proxy keeps carrying traffic.',
    );
    expect(line(proxyPool({ state: 'offline', offline: 'invoicing_only', total: 2 }))).toBe('Offline: no proxy is reachable · invoicing only');
    expect(line(proxyPool({ state: 'offline', mode: 'off', offline: 'kill_switch', total: 2 }))).toBe('Offline: no proxy is reachable · kill switch');
    expect(line(proxyPool({ state: 'offline', mode: 'off', offline: 'open', reachable: 1, total: 2 }))).toBe('Offline: the first proxy is down and the strategy is off · carry on');
    expect(line(proxyPool({ state: 'direct' }))).toBe('No proxy is listed: relays connect straight.');
    expect(line(proxyPool({ state: 'transparent', transparent: true }))).toBe('Transparent proxy declared: nothing is checked.');
    // Off and working: nothing to say.
    expect(line(activePool({ mode: 'off', total: 2, active: 'a', proxies: [one] }), { mode: 'off' })).toBeNull();
  });

  it("says which proxy each key uses, once the keys differ", () => {
    const list = [entry('a', 'socks5://10.0.0.1:1080', 'tor', { keys: ['invoices'] }), entry('b', 'http://10.0.0.2:3128', '', { keys: ['admin'] })];
    const pool = activePool({ active: 'a', total: 2, proxies: list.map((e) => status(e)), lanes: [lane('invoices', 'a'), lane('admin', 'b')] });
    const show = (p: Pool, over: Partial<ProxySettings> = {}) => {
      document.body.innerHTML = '';
      setup({ list, ...over }, { pool: p });
      return laneLines();
    };
    expect(show(pool)).toEqual(['Public invoices: using tor', 'Administration: using http://10.0.0.2:3128']);
    const down = { ...pool, lanes: [lane('invoices', 'a'), lane('admin', null, 'offline'), lane('other', null, 'suspended')] };
    expect(show(down)).toEqual(['Public invoices: using tor', 'Administration: no proxy reachable', 'other: suspended']);
    // With the strategy off, only a key that lost its first proxy is news.
    expect(show({ ...down, mode: 'off' }, { mode: 'off' })).toEqual(['Administration: its first proxy is down']);
    // Nothing to tell apart when every proxy serves every key, or without a status.
    expect(show(pool, { list: TWO() })).toEqual([]);
    document.body.innerHTML = '';
    setup({ list });
    expect(laneLines()).toEqual([]);
  });
});

describe('when no proxy is reachable', () => {
  it('offers four ways, and warns about the ones that go clearnet', async () => {
    const { proxies } = setup({ list: TWO() });
    const group = screen.getByRole('radiogroup', { name: 'When no proxy is reachable' });
    expect(within(group).getAllByRole('radio')).toHaveLength(4);
    expect((within(group).getByLabelText(/Kill switch/) as HTMLInputElement).checked).toBe(true);
    expect(within(group).getAllByText("Relays see this machine's IP address.")).toHaveLength(3);
    await fireEvent.click(within(group).getByLabelText(/Operators only/));
    expect(proxies.offline).toBe('admin_only');
    expect(within(group).getByLabelText(/Operators only/).closest('label')!.className).toContain('on');
  });
});

describe('a transparent proxy', () => {
  it('is declared with one switch, which hides everything else and keeps the list', async () => {
    const { proxies } = setup({ list: TWO() });
    expect((document.querySelector('fieldset.pool-body') as HTMLFieldSetElement).disabled).toBe(false);
    const toggle = screen.getByLabelText(/I run a transparent proxy around this service/);
    await fireEvent.click(toggle);
    expect(proxies.transparent).toBe(true);
    expect(document.querySelector('fieldset.pool-body')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/The service trusts it and checks nothing/);
    await fireEvent.click(toggle);
    expect(proxies.transparent).toBe(false);
    expect(names()).toEqual(['tor', 'Unnamed proxy']);
  });
});

describe('when the proxies are locked on the host', () => {
  it('disables every control and says why', () => {
    setup({ list: TWO() }, { locked: true });
    expect(screen.getByRole('status').textContent).toBe('Locked on the host (DEADHOP_PROXY_LOCKED). These settings can only be changed there.');
    const body = document.querySelector('fieldset.pool-body') as HTMLFieldSetElement;
    expect(body.disabled).toBe(true);
    expect(body.className).toContain('greyed');
    expect((screen.getByLabelText(/I run a transparent proxy/) as HTMLInputElement).disabled).toBe(true);
  });
});
