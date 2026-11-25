import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Settings from './Settings.svelte';
import type { PayApi } from '../lib/api';
import type { ProxyPool, ProxySettings } from '../lib/schemas';
import { activePool, health, proxyCheck, relayHistory, settings, settingsView } from '../test-helpers';

const lane = (key: string, h: ProxyPool['lanes'][number]['groups'][number]) => ({ key, default: { group: h.group }, state: h.state, active: h.active, reachable: h.reachable, next_switch_at: h.next_switch_at, uses_default: true, groups: [h] });

const entry = (id: string, url: string, name = '') => ({ id, name, url });
const group = (id: string, proxies: string[], over: Record<string, unknown> = {}) => ({ id, name: '', proxies, strategy: 'failover' as const, rotate_secs: 3600, chaos_min_secs: 300, chaos_max_secs: 900, ...over });
const TWO = [entry('a', 'socks5://me:***@10.0.0.1:1080', 'tor'), entry('b', 'http://10.0.0.2:3128')];

function setup(over: Partial<ProxySettings> = {}, pool: ProxyPool | null = null, locked = false) {
  const view = settingsView({ settings: settings({ proxies: { ...settings().proxies, ...over } }), fixed: { ...settingsView().fixed, proxy_locked: locked } });
  const fns = {
    getSettings: vi.fn().mockResolvedValue(view),
    updateSettings: vi.fn().mockResolvedValue(view),
    resetSettings: vi.fn(),
    checkProxy: vi.fn().mockResolvedValue(proxyCheck()),
    getRelayHistory: vi.fn().mockResolvedValue(relayHistory({ relays: [] })),
    getHealth: pool === null ? vi.fn().mockRejectedValue(new Error('no')) : vi.fn().mockResolvedValue(health({ proxy_pool: pool })),
  };
  render(Settings, { props: { api: fns as unknown as PayApi, dashboardRelays: ['ws://127.0.0.1:7777'], onChanged: vi.fn(), confirm: () => true, section: 'network', networkView: 'proxies' } });
  return fns;
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
const names = () => [...document.querySelectorAll('.proxy-row .proxy-name')].map((n) => n.textContent);
const patchOf = (t: ReturnType<typeof setup>) => t.updateSettings.mock.calls.at(-1)![0];

afterEach(() => vi.useRealTimers());

describe('the proxy list', () => {
  it('starts empty, and creates a proxy that is saved with its id and becomes the default route', async () => {
    const t = setup();
    await screen.findByText('No proxies. Relays connect straight to this machine.');
    await fireEvent.click(screen.getByRole('button', { name: 'Create proxy' }));
    await fireEvent.input(screen.getByLabelText('Label (optional)'), { target: { value: ' Tor ' } });
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));
    expect(screen.getByRole('alert').textContent).toContain('port');
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '9050' } });
    await fireEvent.input(screen.getByLabelText('User name'), { target: { value: 'me' } });
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));
    expect(screen.getByText('socks5://me:pw@127.0.0.1:9050')).toBeTruthy();
    expect(screen.getByText('not saved')).toBeTruthy();
    expect(screen.getByText(/^Everything else now goes through Tor: it is the default route\./)).toBeTruthy();
    expect(screen.getByText('1 change')).toBeTruthy();
    await save();
    await waitFor(() => expect(t.updateSettings).toHaveBeenCalled());
    const sent = patchOf(t).proxies;
    expect(sent.list).toEqual([{ id: expect.stringMatching(/^p[0-9a-f]{8}$/), name: 'Tor', url: 'socks5://me:pw@127.0.0.1:9050' }]);
    expect(sent.default).toEqual({ proxy: sent.list[0].id });
  });

  it('refuses the same address twice, and can cancel', async () => {
    setup({ list: [entry('b', 'http://10.0.0.2:3128')] });
    await screen.findByText('http://10.0.0.2:3128');
    await fireEvent.click(screen.getByRole('button', { name: 'Create proxy' }));
    await fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'http' } });
    await fireEvent.input(screen.getByLabelText('Host'), { target: { value: '10.0.0.2' } });
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '3128' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));
    expect(screen.getByRole('alert').textContent).toBe('That proxy is already listed.');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Host')).toBeNull();
  });

  it('caps the list at eight', async () => {
    setup({ list: Array.from({ length: 8 }, (_, i) => entry(`p${i}`, `socks5://10.0.0.${i + 1}:1080`)) });
    await screen.findByText('8 of 8');
    expect((screen.getByRole('button', { name: 'Create proxy' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps a hidden password through an edit of the label, and asks for it when the address changes', async () => {
    const t = setup({ list: TWO });
    await screen.findByText('tor');
    await fireEvent.click(screen.getByRole('button', { name: 'Edit proxy 1' }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).placeholder).toBe('unchanged');
    await fireEvent.input(screen.getByLabelText('Label (optional)'), { target: { value: 'onion' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Update proxy' }));
    await save();
    await waitFor(() => expect(patchOf(t).proxies.list[0]).toEqual({ id: 'a', name: 'onion', url: 'socks5://me:***@10.0.0.1:1080' }));

    await fireEvent.click(screen.getByRole('button', { name: 'Edit proxy 1' }));
    await fireEvent.input(screen.getByLabelText('Port'), { target: { value: '9150' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Update proxy' }));
    expect(screen.getByRole('alert').textContent).toContain('Re-enter the proxy password');
    await fireEvent.input(screen.getByLabelText('Password'), { target: { value: 'new' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Update proxy' }));
    await save();
    await waitFor(() => expect(patchOf(t).proxies.list[0]).toEqual({ id: 'a', name: 'tor', url: 'socks5://me:new@10.0.0.1:9150' }));
  });

  it('removes a proxy nothing points at, and not one the default route uses', async () => {
    const t = setup({ list: TWO, default: { proxy: 'b' } });
    await screen.findByText('tor');
    expect((screen.getByRole('button', { name: 'Remove proxy 2' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Carries 0 relays now · used by the default route')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit proxy 2' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove proxy 1' }));
    expect(screen.queryByLabelText('Host')).toBeNull();
    expect(names()).toEqual(['Unnamed proxy']);
    await save();
    await waitFor(() => expect(patchOf(t)).toEqual({ proxies: { list: [{ id: 'b', name: '', url: 'http://10.0.0.2:3128' }] } }));
  });

  it('shows how each proxy is doing, and which ones carry relays', async () => {
    const base = activePool().proxies[0];
    const pool = activePool({
      default: { proxy: 'a' },
      total: 3,
      proxies: [
        { ...base, id: 'a', name: 'tor' },
        { ...base, id: 'b', reachable: false, status: 'failed', reason: 'Nothing is listening at 10.0.0.2:3128.' },
        { ...base, id: 'c', reachable: null, checked_at: null, status: null },
      ],
      active: 'a',
      routes: [{ key: 'invoices', relay: 'ws://127.0.0.1:7777', rule: null, via: 'proxy', proxy: 'a', reason: 'default' }],
    });
    setup({ list: [...TWO, entry('c', 'socks5://10.0.0.3:1')], default: { proxy: 'a' } }, pool);
    await screen.findByText('in use');
    expect(screen.getByText('reachable').className).toBe('badge pass');
    expect(screen.getByText('unreachable').className).toBe('badge fail');
    expect(screen.getByText('Nothing is listening at 10.0.0.2:3128.').tagName).toBe('P');
    expect(screen.getByText('not checked')).toBeTruthy();
    expect(document.querySelector('.strategy-state')!.textContent).toBe('Default route: tor, reachable.');
  });

  it('tests a saved proxy by id, and a changed or new one by its address', async () => {
    const t = setup({ list: TWO });
    await screen.findByText('tor');
    await fireEvent.click(screen.getByRole('button', { name: 'Test proxy 1' }));
    expect(t.checkProxy).toHaveBeenLastCalledWith({ id: 'a' });
    expect(await screen.findByText('Connected')).toBeTruthy();
    t.checkProxy.mockRejectedValueOnce(new Error('rate limit exceeded'));
    await fireEvent.click(screen.getByRole('button', { name: 'Test proxy 2' }));
    expect(await screen.findByText('rate limit exceeded')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Create proxy' }));
    await fireEvent.input(screen.getByLabelText('Host'), { target: { value: '10.9.9.9' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Test proxy 3' }));
    expect(t.checkProxy).toHaveBeenLastCalledWith('socks5://10.9.9.9:9050');
  });
});

describe('the groups', () => {
  it('are made, given a strategy and an interval, and saved whole', async () => {
    const t = setup({ list: TWO });
    await screen.findByText('tor');
    expect(screen.getByText(/^No groups\./)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Exits' } });
    await fireEvent.click(screen.getByLabelText('Round-robin'));
    await fireEvent.input(screen.getByLabelText('Change proxy every'), { target: { value: '30' } });
    await fireEvent.change(screen.getByLabelText('Change proxy every: unit'), { target: { value: 'm' } });
    await save();
    await waitFor(() => expect(t.updateSettings).toHaveBeenLastCalledWith({ proxies: { groups: [group('group-1', ['a', 'b'], { name: 'Exits', strategy: 'round_robin', rotate_secs: 1800 })] } }));
  });

  it('refuses a group of one, a chaos range that runs backwards, an empty interval and one out of range', async () => {
    setup({ list: TWO, groups: [group('g', ['a', 'b'], { name: 'Exits', strategy: 'chaos' })] });
    await screen.findByText('socks5://me:***@10.0.0.1:1080');
    await fireEvent.input(screen.getByLabelText('Shortest time before a change'), { target: { value: '20' } });
    expect(screen.getByText('Group Exits: the shortest chaos interval is longer than the longest.')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Shortest time before a change'), { target: { value: '' } });
    expect(screen.getByText('Group Exits: fill in every interval.')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Shortest time before a change'), { target: { value: '10' } });
    await fireEvent.change(screen.getByLabelText('Shortest time before a change: unit'), { target: { value: 's' } });
    expect(screen.getByText('Group Exits: intervals run from 1 minute to 7 days.')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Shortest time before a change'), { target: { value: '5' } });
    await fireEvent.change(screen.getByLabelText('Shortest time before a change: unit'), { target: { value: 'm' } });
    expect(screen.queryByText(/Group Exits: intervals/)).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Take tor out of Exits' }));
    expect(screen.getByText(/^Group Exits needs at least 2 proxies\./)).toBeTruthy();
  });

  it('says what the default route’s group is doing now, and cannot be removed while in use', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const one = { ...activePool().proxies[0], id: 'a', name: 'tor' };
    const h = { group: 'g', state: 'active' as const, active: 'a', reachable: 2, next_switch_at: 1_700_000_720 };
    const pool = activePool({ default: { group: 'g' }, active: 'a', reachable: 2, next_switch_at: 1_700_000_720, proxies: [one], lanes: [lane('invoices', h), lane('admin', h)] });
    setup({ list: TWO, groups: [group('g', ['a', 'b'], { name: 'Exits', strategy: 'round_robin' })], default: { group: 'g' } }, pool);
    await waitFor(() => expect(document.querySelector('.strategy-state')).toBeTruthy());
    expect([...document.querySelectorAll('.strategy-state')].map((e) => e.textContent)).toEqual(['Now: using tor · next switch in 12m', 'Default route: Group Exits, using tor · next switch in 12m.']);
    expect((screen.getByRole('button', { name: 'Remove group Exits' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the status of the proxies', () => {
  it('is read again every ten seconds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const t = setup({ list: TWO });
    await screen.findByText('tor');
    expect(t.getHealth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(t.getHealth).toHaveBeenCalledTimes(2);
  });
});

describe('when the default route has nothing reachable', () => {
  it('offers four ways, with the kill switch as the default, and warns about the ones that go clearnet', async () => {
    const t = setup({ list: TWO });
    await screen.findByText('tor');
    const policy = screen.getByRole('radiogroup', { name: 'When the default route has nothing reachable' });
    expect(within(policy).getAllByRole('radio')).toHaveLength(4);
    expect((within(policy).getByLabelText(/Kill switch/) as HTMLInputElement).checked).toBe(true);
    expect(within(policy).getAllByText("Relays see this machine's IP address.")).toHaveLength(3);
    await fireEvent.click(within(policy).getByLabelText(/Operators only/));
    expect(screen.getByText('1 change')).toBeTruthy();
    await fireEvent.click(within(policy).getByLabelText(/Kill switch/));
    expect(screen.queryByText('1 change')).toBeNull();
    await fireEvent.click(within(policy).getByLabelText(/Operators only/));
    await save();
    await waitFor(() => expect(t.updateSettings).toHaveBeenLastCalledWith({ proxies: { offline: 'admin_only' } }));
  });
});

describe('a transparent proxy', () => {
  it('is declared with one switch, which hides everything else and keeps the data', async () => {
    const t = setup({ list: TWO });
    await screen.findByText('tor');
    expect((document.querySelector('fieldset.pool-body') as HTMLFieldSetElement).disabled).toBe(false);
    const toggle = screen.getByLabelText(/I run a transparent proxy around this service/);
    await fireEvent.click(toggle);
    expect(document.querySelector('fieldset.pool-body')).toBeNull();
    expect(screen.getByText(/The service trusts it and checks nothing/)).toBeTruthy();
    await fireEvent.click(toggle);
    expect(names()).toEqual(['tor', 'Unnamed proxy']);
    await fireEvent.click(toggle);
    await save();
    await waitFor(() => expect(t.updateSettings).toHaveBeenLastCalledWith({ proxies: { transparent: true } }));
  });
});

describe('when the proxies are locked on the host', () => {
  it('disables every control and says why', async () => {
    setup({ list: TWO }, null, true);
    await screen.findByText(/Locked on the host/);
    expect((document.querySelector('fieldset.pool-body') as HTMLFieldSetElement).disabled).toBe(true);
    expect((screen.getByLabelText(/I run a transparent proxy/) as HTMLInputElement).disabled).toBe(true);
  });
});
