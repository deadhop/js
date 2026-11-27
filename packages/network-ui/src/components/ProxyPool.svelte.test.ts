import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import ProxyPool from './ProxyPool.svelte';
import type { NetworkApi } from '../lib/network-api';
import type { KeyInfo, ProxyEntry, ProxyPool as Pool, ProxySettings, Rule } from '../lib/schemas';
import { activePool, fourKeys, group, keyInfos, lane, proxyCheck, proxyPool, settings } from '../test-helpers';

const entry = (id: string, url: string, name = '', over: Partial<ProxyEntry> = {}): ProxyEntry => ({ id, name, url, ...over });
const TWO = () => [entry('a', 'socks5://me:***@10.0.0.1:1080', 'tor'), entry('b', 'http://10.0.0.2:3128')];
const status = (e: ProxyEntry, over: Partial<Pool['proxies'][number]> = {}): Pool['proxies'][number] => ({
  id: e.id, name: e.name, url: e.url, reachable: true, checked_at: 1_700_000_050, status: 'connected', reason: null, ...over,
});
const i2pRule = (to: Rule['to']): Rule => ({ name: '', match: ['*.i2p'], keys: [], to, fallback: 'offline' });

function setup(over: Partial<ProxySettings> = {}, opts: { pool?: Pool | null; locked?: boolean; live?: ProxySettings; registriesAt?: string; keys?: KeyInfo[] } = {}) {
  // The form settings the parent hands over are deeply reactive, and the view changes them in place.
  const proxies: ProxySettings = $state({ ...settings().proxies, ...over });
  const live = opts.live ?? { ...settings().proxies, ...over, list: [...(over.list ?? [])] };
  const api = { checkProxy: vi.fn().mockResolvedValue(proxyCheck()) };
  render(ProxyPool, { props: { api: api as unknown as NetworkApi, keys: opts.keys ?? keyInfos(), proxies, live, pool: opts.pool ?? null, locked: opts.locked ?? false, ...(opts.registriesAt === undefined ? {} : { registriesAt: opts.registriesAt }) } });
  return { api, proxies };
}

const rows = () => [...document.querySelectorAll('li.proxy-row')];
const names = () => rows().map((r) => r.querySelector('.proxy-name')!.textContent);
const ids = (p: ProxySettings) => p.list.map((e) => e.id);
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const stateLine = () => document.querySelector('.field.strategy .strategy-state')?.textContent ?? null;
const laneLines = () => [...(screen.queryByRole('list', { name: 'Default route, per key' })?.querySelectorAll('li') ?? [])].map((li) => li.textContent);

afterEach(() => vi.useRealTimers());

describe('the proxy list', () => {
  it('starts empty, and creates a proxy as a new entry that becomes the default route', async () => {
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
    expect(proxies.list[0]).toMatchObject({ name: 'Tor', url: 'socks5://me:pw@127.0.0.1:9050', i2p: false });
    expect(proxies.list[0].id).toMatch(/^p[0-9a-f]{8}$/);
    // The first proxy becomes the default route, and the page says so.
    expect(proxies.default).toEqual({ proxy: proxies.list[0].id });
    expect(screen.getByRole('status').textContent).toBe('Everything else now goes through Tor: it is the default route. Change that under Rules, in the last row.');
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
    expect(proxies.list[0]).toEqual({ id: 'a', name: 'onion', url: 'socks5://me:***@10.0.0.1:1080', i2p: false });

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

  it('makes only the first proxy the default route, and never an I2P router', async () => {
    const add = async (kind: string, host: string) => {
      await fireEvent.click(button('Create proxy'));
      await fireEvent.change(screen.getByLabelText('Type'), { target: { value: kind } });
      await fireEvent.input(screen.getByLabelText('Host'), { target: { value: host } });
      await fireEvent.click(button('Add to list'));
    };
    const { proxies } = setup();
    await add('i2p', '10.0.0.9');
    expect(proxies.default).toBe('direct');
    await add('socks5', '10.0.0.1');
    expect(proxies.default).toEqual({ proxy: proxies.list[1].id });
    await add('socks5', '10.0.0.2');
    expect(proxies.default).toEqual({ proxy: proxies.list[1].id });
    // A default route chosen already is kept.
    document.body.innerHTML = '';
    const blocked = setup({ default: 'block' });
    await add('socks5', '10.0.0.1');
    expect(blocked.proxies.default).toBe('block');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('removes a proxy, closing the form, unless something points at it', async () => {
    const { proxies } = setup({ list: [...TWO(), entry('c', 'socks5://10.0.0.3:1')], groups: [group('g', ['a', 'c'], { name: 'Exits' })], default: { proxy: 'b' } });
    for (const i of [1, 2, 3]) expect((button(`Remove proxy ${i}`) as HTMLButtonElement).disabled).toBe(true);
    expect(button('Remove proxy 1').getAttribute('title')).toBe('Used by group Exits: change those first.');
    expect(button('Remove proxy 2').getAttribute('title')).toBe('Used by the default route: change those first.');
    proxies.groups = [];
    await fireEvent.click(button('Edit proxy 2'));
    await fireEvent.click(button('Remove proxy 3'));
    expect(screen.queryByLabelText('Host')).toBeNull();
    expect(ids(proxies)).toEqual(['a', 'b']);
    expect(button('Remove proxy 1').getAttribute('title')).toBeNull();
  });

  it('says what each proxy carries and which rules point at it', () => {
    const list = [entry('a', 'socks5://10.0.0.1:1080', 'tor'), entry('b', 'http://10.0.0.2:3128'), entry('c', 'socks5://10.0.0.3:1080')];
    const route = (relay: string, p: string) => ({ key: 'invoices', relay, rule: null, via: 'proxy' as const, proxy: p, reason: 'default' as const });
    const rule = (to: Rule['to'], fallback: Rule['fallback'] = 'offline'): Rule => ({ name: '', match: ['wss://x'], keys: [], to, fallback });
    setup(
      { list, rules: [rule({ proxy: 'b' }), rule('direct'), rule({ proxy: 'b' }, { to: { proxy: 'c' } })], default: { proxy: 'a' } },
      { pool: activePool({ active: 'a', routes: [route('wss://one', 'a'), route('wss://one', 'a'), route('wss://two', 'b'), route('wss://three', 'b')] }) },
    );
    const carries = rows().map((r) => r.querySelector('.proxy-routes .hint')!.textContent);
    expect(carries).toEqual(['Carries 1 relay now · used by the default route', 'Carries 2 relays now · used by rule 1, rule 3', 'Carries 0 relays now · used by the fallback of rule 3']);
  });

  it('without a status from the service, carries nothing and is not checked', () => {
    setup({ list: TWO() });
    expect(rows().map((r) => r.querySelector('.proxy-routes .hint')!.textContent)).toEqual(['Carries 0 relays now · nothing points at it yet', 'Carries 0 relays now · nothing points at it yet']);
    expect(screen.getAllByText('not checked')).toHaveLength(2);
  });

  it('shows how each proxy is doing, and which ones carry relays', () => {
    const list = [...TWO(), entry('c', 'socks5://10.0.0.3:1'), entry('d', 'socks5://10.0.0.4:1'), entry('e', 'socks5://10.0.0.5:1')];
    const pool = activePool({
      active: 'a',
      routes: [{ key: 'invoices', relay: 'wss://x', rule: null, via: 'proxy', proxy: 'a', reason: 'default' }],
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
  it('is created with its usual port, and is not made the default route', async () => {
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
    expect(proxies.list[0]).toMatchObject({ name: 'i2pd', url: 'http://127.0.0.1:4444', i2p: true });
    expect(proxies.default).toBe('direct');
    expect(screen.getByText('I2P router').className).toBe('badge i2p-badge');
    // Not saved yet, a rule can still name it: its id is already chosen.
    expect(screen.getByRole('button', { name: 'Send .i2p relays through this proxy' })).toBeTruthy();
    // Only one router: the choice is closed to a second proxy, not to the router itself.
    await fireEvent.click(button('Create proxy'));
    expect(screen.getByText('An I2P router is already listed. Only one can be.')).toBeTruthy();
    expect((screen.getByRole('option', { name: 'I2P router' }) as HTMLOptionElement).disabled).toBe(true);
    await fireEvent.click(button('Cancel'));
    await fireEvent.click(button('Edit proxy 1'));
    expect((screen.getByLabelText('Type') as HTMLSelectElement).value).toBe('i2p');
    expect((screen.getByRole('option', { name: 'I2P router' }) as HTMLOptionElement).disabled).toBe(false);
  });

  it('says where the page keeps the I2P name registries', () => {
    const router = entry('r', 'http://127.0.0.1:4444', '', { i2p: true });
    setup({ list: [router] }, { registriesAt: 'below' });
    expect(screen.getByText('http://127.0.0.1:4444 carries relays only when a rule sends them to it. Where .i2p names are looked up is below.')).toBeTruthy();
  });

  it('once saved, offers a rule that sends .i2p relays through it', async () => {
    const router = entry('r', 'http://127.0.0.1:4444', '', { i2p: true });
    const { proxies } = setup({ list: [router] });
    expect(screen.getByText('http://127.0.0.1:4444 carries relays only when a rule sends them to it. Where .i2p names are looked up is under Settings.')).toBeTruthy();
    await fireEvent.click(button('Send .i2p relays through this proxy'));
    expect(proxies.rules).toEqual([i2pRule({ proxy: 'r' })]);
    expect(screen.getByText('Rule 1 decides where .i2p relays go: http://127.0.0.1:4444.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send .i2p relays through this proxy' })).toBeNull();
  });

  it('names the rule that already decides, and cannot add a thirty-third', () => {
    const other: Rule = { name: '', match: ['wss://x'], keys: [], to: 'direct', fallback: 'offline' };
    const router = entry('r', 'http://127.0.0.1:4444', 'i2pd', { i2p: true });
    setup({ list: [router], rules: [other, i2pRule('block')] });
    expect(screen.getByText('Rule 2 decides where .i2p relays go: nowhere: blocked.')).toBeTruthy();
    document.body.innerHTML = '';
    setup({ list: [router], rules: Array.from({ length: 32 }, () => other) });
    expect((button('Send .i2p relays through this proxy') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('what the service is doing', () => {
  const one = status(entry('a', 'socks5://10.0.0.1:1080', 'tor'));
  const groups = [group('g', ['a', 'b'], { name: 'Exits' })];
  const line = (pool: Pool, over: Partial<ProxySettings> = {}) => {
    document.body.innerHTML = '';
    setup({ list: TWO(), groups, ...over }, { pool });
    return stateLine();
  };

  it('says where the default route goes and what it does now, in one line', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const h = { group: 'g', state: 'active' as const, active: 'a', reachable: 2, next_switch_at: 1_700_000_720 };
    expect(line(activePool({ default: { group: 'g' }, active: 'a', reachable: 2, next_switch_at: 1_700_000_720, proxies: [one], lanes: [lane('invoices', { default: { group: 'g' }, groups: [h] })] }))).toBe(
      'Default route: Group Exits, using tor · next switch in 12m.',
    );
    // The soonest switch of a rule's group is not the default route's.
    expect(line(activePool({ default: { proxy: 'a' }, active: 'a', next_switch_at: 1_700_000_720, proxies: [one] }))).toBe('Default route: tor, reachable.');
    expect(line(proxyPool({ state: 'suspended', default: { group: 'g' }, reachable: 1, active: 'a', proxies: [one] }))).toBe('Default route: Group Exits, using tor · rotation suspended: only 1 proxy is reachable.');
    expect(line(activePool({ default: { proxy: 'a' }, active: 'a', proxies: [one] }))).toBe('Default route: tor, reachable.');
    expect(line(proxyPool({ state: 'offline', default: { group: 'g' }, offline: 'invoicing_only' }))).toBe('Default route: offline: no proxy in Group Exits is reachable · invoicing only.');
    expect(line(proxyPool({ state: 'offline', default: { proxy: 'a' }, offline: 'kill_switch' }))).toBe('Default route: offline: tor is down · kill switch.');
    expect(line(proxyPool({ state: 'direct' }))).toBe('Default route: direct: relays that no rule matches connect straight.');
    expect(line(proxyPool({ state: 'blocked', default: 'block' }))).toBe('Default route: blocked: relays that no rule matches are not connected.');
    expect(line(proxyPool({ state: 'transparent', transparent: true }))).toBe('Transparent proxy declared: nothing is checked.');
    expect(screen.getByText('Relays that no rule matches go to direct, no proxy. Change it under Rules, in the last row.')).toBeTruthy();
  });

  it("says where each key's default route goes, once a key has one of its own", () => {
    const pool = activePool({
      default: { proxy: 'a' },
      proxies: TWO().map((e) => status(e)),
      lanes: [
        lane('invoices', { default: { proxy: 'a' }, state: 'active', active: 'a' }),
        lane('admin', { default: { group: 'g' }, state: 'active', active: 'b', groups: [{ group: 'g', state: 'active', active: 'b', reachable: 2, next_switch_at: null }] }),
        lane('other', { default: { group: 'g' }, state: 'offline' }),
        lane('gone', { default: { group: 'x' }, state: 'active', active: 'a' }),
      ],
    });
    const show = (over: Partial<ProxySettings>, p: Pool | null = pool) => {
      document.body.innerHTML = '';
      setup({ list: TWO(), groups, default: { proxy: 'a' }, ...over }, { pool: p });
      return laneLines();
    };
    expect(show({ default_keys: { admin: { group: 'g' } } })).toEqual([
      'Public invoices: tor, reachable',
      'Administration: Group Exits, using http://10.0.0.2:3128',
      'other: offline: no proxy in Group Exits is reachable · kill switch',
      'gone: A group that no longer exists, reachable',
    ]);
    expect(screen.getByText(/unless their key has a default route of its own/)).toBeTruthy();
    // Nothing to tell apart when every key shares the default route, or without a status.
    expect(show({})).toEqual([]);
    expect(show({ default_keys: { admin: 'direct' } }, null)).toEqual([]);
  });
});

describe('when the default route has nothing reachable', () => {
  it('offers four ways, and warns about the ones that go clearnet', async () => {
    const { proxies } = setup({ list: TWO() });
    const group = screen.getByRole('radiogroup', { name: 'When the default route has nothing reachable' });
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

describe('which keys use a proxy', () => {
  it('stays as it is with two keys', () => {
    setup({ list: TWO(), default: { proxy: 'a' } });
    expect(screen.queryByRole('button', { name: /keys that use it/ })).toBeNull();
  });

  it('sums up the keys with three or more, and opens them', async () => {
    const rule: Rule = { name: '', match: ['*.onion'], keys: ['oven'], to: { proxy: 'b' }, fallback: 'offline' };
    setup({ list: [...TWO(), entry('c', 'socks5://10.0.0.3:1080')], default: { proxy: 'a' }, default_keys: { oven: 'direct' }, rules: [rule] }, { keys: fourKeys() });
    const a = button('Proxy 1: keys that use it');
    expect(a.textContent).toBe('3 of 4 keys ▾');
    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(button('Proxy 2: keys that use it').textContent).toBe('1 of 4 keys ▾');
    // Nothing points at proxy 3: no summary.
    expect(screen.queryByRole('button', { name: 'Proxy 3: keys that use it' })).toBeNull();
    await fireEvent.click(a);
    expect(a.textContent).toBe('3 of 4 keys ▴');
    const tags = [...a.parentElement!.querySelectorAll('.key-tag')];
    expect(tags.map((t) => [t.textContent, t.classList.contains('off')])).toEqual([
      ['Administration', false],
      ['Storefront', false],
      ['Catering orders', false],
      ['Oven fund', true],
    ]);
    await fireEvent.click(a);
    expect(a.parentElement!.querySelector('.key-tag')).toBeNull();
  });
});
