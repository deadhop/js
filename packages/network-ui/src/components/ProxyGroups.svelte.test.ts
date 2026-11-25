import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import ProxyGroups from './ProxyGroups.svelte';
import type { ProxyEntry, ProxyPool, ProxySettings } from '../lib/schemas';
import { activePool, group, keyInfos, lane, settings } from '../test-helpers';

const entry = (id: string, name: string, over: Partial<ProxyEntry> = {}): ProxyEntry => ({ id, name, url: `socks5://${id}:1`, ...over });
const THREE = () => [entry('i2p', 'i2pd', { i2p: true, url: 'http://127.0.0.1:4444' }), entry('tor', 'Tor'), entry('vpn', 'VPN')];

function setup(over: Partial<ProxySettings> = {}, opts: { pool?: ProxyPool | null; live?: ProxySettings } = {}) {
  const proxies: ProxySettings = $state({ ...settings().proxies, list: THREE(), ...over });
  const live = opts.live ?? { ...settings().proxies, ...over };
  render(ProxyGroups, { props: { keys: keyInfos(), proxies, live, pool: opts.pool ?? null } });
  return proxies;
}

const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;
const members = () => within(screen.getByRole('list', { name: 'Proxies, in order' })).getAllByRole('listitem').map((li) => li.querySelector('span:nth-child(2)')!.textContent);

describe('the groups', () => {
  it('start empty, and need two proxies before one can be made', () => {
    setup({ list: [entry('tor', 'Tor')] });
    expect(screen.getByText(/^No groups\./)).toBeTruthy();
    expect(button('New group').disabled).toBe(true);
    expect(screen.getByText('A group needs at least two proxies in the list.')).toBeTruthy();
  });

  it('are made from the first two proxies that are not the I2P router, failover, and not saved yet', async () => {
    const proxies = setup();
    await fireEvent.click(button('New group'));
    expect(proxies.groups).toEqual([group('group-1', ['tor', 'vpn'], { name: 'Group 1', strategy: 'failover' })]);
    expect(screen.getByText('not saved')).toBeTruthy();
    expect(screen.getByText('Nothing points at it yet.')).toBeTruthy();
    expect(members()).toEqual(['Tor', 'VPN']);
    // Renaming keeps the id that rules and the default route use.
    await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Exits' } });
    expect(proxies.groups[0]).toMatchObject({ id: 'group-1', name: 'Exits' });
    // Once the name is typed, a group not saved yet that nothing points at takes its id from it.
    await fireEvent.change(screen.getByLabelText('Name'));
    expect(proxies.groups[0].id).toBe('exits');
    await fireEvent.change(screen.getByLabelText('Name'));
    expect(proxies.groups[0].id).toBe('exits');
    await fireEvent.click(button('New group'));
    expect(proxies.groups.map((g) => [g.id, g.name])).toEqual([
      ['exits', 'Exits'],
      ['group-2', 'Group 2'],
    ]);
    // Named like another, it takes the next id free.
    await fireEvent.input(screen.getAllByLabelText('Name')[1], { target: { value: 'Exits' } });
    await fireEvent.change(screen.getAllByLabelText('Name')[1]);
    expect(proxies.groups[1].id).toBe('exits-2');
  });

  it('stop at eight', () => {
    setup({ groups: Array.from({ length: 8 }, (_, i) => group(`g${i}`, ['tor', 'vpn'])) });
    expect(button('New group').disabled).toBe(true);
    expect(screen.getByText('8 groups is the most.')).toBeTruthy();
  });

  it('order their proxies, take one out and add one, asking for two at least', async () => {
    const saved = group('exits', ['tor', 'vpn'], { name: 'Exits' });
    const proxies = setup({ groups: [saved] }, { live: { ...settings().proxies, groups: [saved] } });
    expect(screen.queryByText('not saved')).toBeNull();
    expect(button('Move Tor up in Exits').disabled).toBe(true);
    expect(button('Move VPN down in Exits').disabled).toBe(true);
    await fireEvent.click(button('Move VPN up in Exits'));
    expect(proxies.groups[0].proxies).toEqual(['vpn', 'tor']);
    await fireEvent.click(button('Move VPN down in Exits'));
    expect(proxies.groups[0].proxies).toEqual(['tor', 'vpn']);
    await fireEvent.click(button('Take VPN out of Exits'));
    expect(proxies.groups[0].proxies).toEqual(['tor']);
    expect(screen.getByRole('alert').textContent).toBe('A group needs at least 2 proxies. To use one proxy, point the rule or the default route at it.');
    const add = screen.getByLabelText('Add a proxy to Exits') as HTMLSelectElement;
    expect([...add.options].map((o) => o.textContent)).toEqual(['Add a proxy…', 'i2pd', 'VPN']);
    await fireEvent.change(add, { target: { selectedIndex: 2 } });
    expect(proxies.groups[0].proxies).toEqual(['tor', 'vpn']);
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('Add a proxy to Exits') as HTMLSelectElement).selectedIndex).toBe(0);
    await fireEvent.change(screen.getByLabelText('Add a proxy to Exits'), { target: { selectedIndex: 1 } });
    expect(proxies.groups[0].proxies).toEqual(['tor', 'vpn', 'i2p']);
    // Every proxy is in it: nothing left to add.
    expect(screen.queryByLabelText('Add a proxy to Exits')).toBeNull();
  });

  it('have a strategy, with the intervals that belong to it', async () => {
    const proxies = setup({ groups: [group('exits', ['tor', 'vpn'], { strategy: 'failover' })] });
    expect((screen.getByLabelText('Failover') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/go back to an earlier one once it has stayed up for 2 minutes/)).toBeTruthy();
    expect(screen.queryByText(/Rotation needs two reachable proxies/)).toBeNull();
    expect(screen.queryByLabelText('Change proxy every')).toBeNull();

    await fireEvent.click(screen.getByLabelText('Round-robin'));
    expect(proxies.groups[0].strategy).toBe('round_robin');
    expect(screen.getByText(/not per connection/)).toBeTruthy();
    expect(screen.getByText(/Rotation needs two reachable proxies/)).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Change proxy every'), { target: { value: '30' } });
    await fireEvent.change(screen.getByLabelText('Change proxy every: unit'), { target: { value: 'm' } });
    expect(proxies.groups[0].rotate_secs).toBe(1800);

    await fireEvent.click(screen.getByLabelText('Chaos'));
    expect(proxies.groups[0].strategy).toBe('chaos');
    expect(screen.queryByLabelText('Change proxy every')).toBeNull();
    expect(screen.getByText('A random time in between, now 5m to 15m.')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText('Longest time before a change'), { target: { value: '30' } });
    expect(proxies.groups[0].chaos_max_secs).toBe(1800);
    await fireEvent.input(screen.getByLabelText('Shortest time before a change'), { target: { value: '10' } });
    expect(proxies.groups[0].chaos_min_secs).toBe(600);
    expect(screen.getByText('A random time in between, now 10m to 30m.')).toBeTruthy();
  });

  it('say what each uses now, once when the keys agree', () => {
    const h = (active: string) => ({ group: 'exits', state: 'active' as const, active, reachable: 2, next_switch_at: null });
    const proxies = [{ ...activePool().proxies[0], id: 'tor', name: 'Tor' }, { ...activePool().proxies[0], id: 'vpn', name: 'VPN' }];
    setup({ groups: [group('exits', ['tor', 'vpn'])] }, { pool: activePool({ proxies, lanes: [lane('invoices', { groups: [h('tor')] }), lane('admin', { groups: [h('tor')] })] }) });
    expect(screen.getByRole('status').textContent).toBe('Now: using Tor');
    document.body.innerHTML = '';
    setup({ groups: [group('exits', ['tor', 'vpn'])] }, { pool: activePool({ proxies, lanes: [lane('invoices', { groups: [h('tor')] }), lane('admin', { groups: [h('vpn')] })] }) });
    expect(screen.getAllByRole('status').map((s) => s.textContent)).toEqual(['Public invoices: using Tor', 'Administration: using VPN']);
  });

  it('change only the group being edited', async () => {
    const proxies = setup({ groups: [group('a', ['tor', 'vpn'], { name: 'A' }), group('b', ['vpn', 'tor'], { name: 'B' })] });
    await fireEvent.click(button('Move tor up in B'.replace('tor', 'Tor')));
    expect(proxies.groups.map((g) => g.proxies)).toEqual([
      ['tor', 'vpn'],
      ['tor', 'vpn'],
    ]);
  });

  it('keep their id once saved, or once something points at them', async () => {
    const saved = group('exits', ['tor', 'vpn'], { name: 'Exits' });
    const proxies = setup({ groups: [saved, group('new', ['tor', 'vpn'], { name: 'New' })], default: { group: 'new' } }, { live: { ...settings().proxies, groups: [saved] } });
    const [first, second] = screen.getAllByLabelText('Name');
    await fireEvent.input(first, { target: { value: 'Renamed' } });
    await fireEvent.change(first);
    await fireEvent.input(second, { target: { value: 'Other' } });
    await fireEvent.change(second);
    expect(proxies.groups.map((g) => [g.id, g.name])).toEqual([
      ['exits', 'Renamed'],
      ['new', 'Other'],
    ]);
  });

  it('cannot be removed while something points at them', async () => {
    const proxies = setup({ groups: [group('exits', ['tor', 'vpn'], { name: 'Exits' }), group('spare', ['vpn', 'tor'])], default: { group: 'exits' } });
    expect(screen.getByText('Used by the default route.')).toBeTruthy();
    expect(button('Remove group Exits').disabled).toBe(true);
    expect(button('Remove group Exits').title).toBe('Used by the default route: change those first.');
    expect(button('Remove group spare').title).toBe('');
    await fireEvent.click(button('Remove group spare'));
    expect(proxies.groups.map((g) => g.id)).toEqual(['exits']);
  });
});
