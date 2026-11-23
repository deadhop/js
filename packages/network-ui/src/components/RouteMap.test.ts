// The map: where every relay goes as the service decided it, why, what each
// proxy carries, and where a typed address would go.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import RouteMap from './RouteMap.svelte';
import { keyInfos, proxyPool, settings } from '../test-helpers';
import type { KeyInfo, NetworkSettings, ProxyPool, RouteState, Rule } from '../lib/schemas';

const ONION = 'ws://abc.onion';
const FIPS = 'ws://npub1x.fips:7777';
const LAN = 'ws://relay.lan:4869';
const A = 'wss://relay.contextvm.org';
const B = 'wss://bucket.coracle.social';
const C = 'wss://relay2.contextvm.org';
const RELAYS = [A, B, C, ONION, FIPS, LAN];

const proxy = (id: string, name: string, pool = true) => ({ id, name, url: `socks5://${id}:1`, keys: [], pool });
const LIST = [proxy('tor', 'tor'), proxy('vpn', 'vpn-eu'), proxy('i2p', 'i2p', false)];
const rule = (match: string[], to: Rule['to'], over: Partial<Rule> = {}): Rule => ({ name: '', match, keys: [], to, fallback: 'offline', ...over });
const RULES: Rule[] = [
  rule(['*.onion'], { proxy: 'tor' }),
  rule(['*.i2p'], { proxy: 'i2p' }),
  rule(['*.fips'], 'direct', { name: 'FIPS mesh' }),
  rule(['*.lan'], 'direct'),
  rule([A, C], { proxy: 'vpn' }, { fallback: 'pool' }),
];
const r = (key: string, relay: string, rule: number | null, via: RouteState['via'], proxyId: string | null, reason: RouteState['reason']): RouteState => ({ key, relay, rule, via, proxy: proxyId, reason });
const ROUTES: RouteState[] = ['invoices', 'admin'].flatMap((k) => [
  r(k, A, 5, 'proxy', 'tor', 'fallback'),
  r(k, B, null, 'proxy', 'tor', 'default'),
  r(k, C, 5, 'proxy', 'tor', 'fallback'),
  ...(k === 'invoices' ? [r(k, ONION, 1, 'proxy', 'tor', 'rule')] : []),
  r(k, FIPS, 3, 'direct', null, 'rule'),
  r(k, LAN, 4, 'direct', null, 'rule'),
]);
const ph = (id: string, name: string, reachable: boolean | null, pool = true) => ({ id, name, url: `socks5://${id}:1`, reachable, checked_at: 1, status: 'connected', reason: null, keys: [], pool });
const POOL = proxyPool({ state: 'active', active: 'tor', proxies: [ph('tor', 'tor', true), ph('vpn', 'vpn-eu', false), ph('i2p', 'i2p', null, false)], routes: ROUTES });

function base(over: Partial<NetworkSettings> = {}, proxies: Partial<NetworkSettings['proxies']> = {}): NetworkSettings {
  const s = settings({ relays: RELAYS, relay_keys: { [ONION]: ['invoices'] }, ...over });
  return { ...s, proxies: { ...s.proxies, list: LIST, rules: RULES, ...proxies } };
}
const show = (live: NetworkSettings = base(), pool: ProxyPool = POOL, keys: KeyInfo[] = keyInfos()) => render(RouteMap, { props: { keys, live, pool } });

const text = (el: Element) => {
  const parts: string[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) parts.push(walk.currentNode.textContent!);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};
const table = () => screen.getByRole('table', { name: 'Route of every relay' });
const cards = () => [...document.querySelectorAll('.map-proxy')].map(text);

describe('RouteMap', () => {
  it('shows every relay’s route, why, and what each proxy carries', async () => {
    show();
    const rows = within(table()).getAllByRole('row').slice(1).map(text);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toBe(`${A} All keys 5 ${A}, ${C} tor fallback: the rule’s proxy is down Internet through the proxy`);
    expect(rows[1]).toBe(`${B} All keys · default route tor default route Internet through the proxy`);
    expect(rows[3]).toBe(`${ONION} Public invoices 1 *.onion tor by the rule Tor hidden service never leaves Tor`);
    expect(rows[4]).toBe(`${FIPS} All keys 3 *.fips Direct by the rule FIPS mesh encrypted end to end`);
    expect(rows[5]).toBe(`${LAN} All keys 4 *.lan Direct by the rule This network not the internet`);
    expect(within(table()).getAllByRole('row')[1].className).toContain('fallback');
    expect(within(table()).getAllByRole('row')[1].querySelector('.via-pill.proxy-c0')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(`2 relays are on the default route because the proxy their rule names is down: ${A}, ${C}.`);
    expect([...document.querySelectorAll('.map-tile')].map(text)).toEqual(['Relays 6 Every relay has a route', 'Rules 5 1 match no relay yet', 'Proxies 3 1 down', 'Direct 2 None to the open internet']);
    expect(cards()[0]).toBe('tor reachable socks5://tor:1 4 relays (2 as a fallback) Rule 1 points here Default route, 1 in order');
    expect(cards()[1]).toBe('vpn-eu down socks5://vpn:1 0 relays Rule 5 points here Default route, 2 in order');
    expect(cards()[2]).toBe('i2p not checked socks5://i2p:1 0 relays Rule 2 points here Rules only: not in the default route');
    // One key at a time.
    await fireEvent.click(screen.getByLabelText('Administration'));
    expect(within(table()).getAllByRole('row')).toHaveLength(6);
    expect(text(within(table()).getAllByRole('row')[1])).toContain(`${A} Administration 5`);
    await fireEvent.click(screen.getByLabelText('Public invoices'));
    expect(within(table()).getAllByRole('row')).toHaveLength(7);
    await fireEvent.click(screen.getByLabelText('All keys'));
    expect(within(table()).getAllByRole('row')).toHaveLength(7);
    expect((screen.getByLabelText('All keys') as HTMLInputElement).checked).toBe(true);
  });

  it('traces an address through the rules, per key when they differ', async () => {
    const rules = [rule(['*.onion'], { proxy: 'tor' }), rule(['x.example'], 'pool'), rule(['y.example'], 'direct'), rule(['z.example'], 'block', { keys: ['admin'] }), rule(['gone.example'], { proxy: 'gone' }), rule(['n.example'], { proxy: 'vpn' })];
    show(base({}, { rules, list: [proxy('tor', 'tor'), { ...proxy('vpn', ''), url: 'socks5://v:1' }] }));
    const box = screen.getByLabelText('Try an address: which rule, which proxy?');
    const said = async (url: string) => {
      await fireEvent.input(box, { target: { value: url } });
      return [...document.querySelectorAll('.try-result')].map((e) => e.textContent);
    };
    expect(await said('ws://abc.onion')).toEqual(['Rule 1 matches (*.onion): through tor']);
    expect(await said('wss://x.example')).toEqual(['Rule 2 matches (x.example): the default route']);
    expect(await said('wss://y.example')).toEqual(['Rule 3 matches (y.example): direct, no proxy']);
    expect(await said('wss://z.example')).toEqual(['Public invoices: No rule matches: the default route', 'Administration: Rule 4 matches (z.example): blocked']);
    expect(await said('wss://gone.example')).toEqual(['Rule 5 matches (gone.example): through gone']);
    expect(await said('  wss://n.example  ')).toEqual(['Rule 6 matches (n.example): through socks5://v:1']);
    expect(await said('not an address')).toEqual([]);
  });

  it('warns about relays with no route, and shows an unknown proxy by its id', () => {
    const routes = [r('invoices', A, 1, 'off', null, 'proxy_down'), r('admin', A, 1, 'off', null, 'proxy_down'), r('invoices', B, null, 'proxy', 'ghost', 'default'), r('admin', B, null, 'proxy', 'tor', 'default')];
    show(base({ relays: [A, B] }, { list: [proxy('tor', 'tor')], rules: [rule([A], { proxy: 'tor' }), rule([B], { proxy: 'tor' })] }), proxyPool({ routes, proxies: [ph('tor', 'tor', false)] }));
    expect(screen.getByRole('alert').textContent).toBe(`1 relay has no route now: ${A}.`);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('No connection')).toBeTruthy();
    const ghost = within(table()).getAllByRole('row').find((row) => text(row).includes('ghost'))!;
    expect(text(ghost)).toBe(`${B} Public invoices · default route ghost default route Internet through the proxy`);
    expect(ghost.querySelector('.via-pill')!.className).toBe('via-pill ');
    expect(cards()).toEqual(['tor down socks5://tor:1 1 relay Rules 1, 2 point here Default route, 1 in order']);
  });

  it('counts several dark relays and one fallback, and has no proxies to describe', () => {
    const routes = [r('invoices', A, null, 'off', null, 'pool_offline'), r('invoices', B, 1, 'off', null, 'blocked'), r('invoices', C, null, 'off', null, 'pool_offline'), r('invoices', LAN, null, 'proxy', 'tor', 'fallback')];
    show(base({ relays: [A, B, C, LAN] }, { list: [], rules: [rule([B], 'block')] }), proxyPool({ routes }), keyInfos().slice(0, 1));
    expect(screen.getByRole('alert').textContent).toBe(`2 relays have no route now: ${A}, ${C}.`);
    expect(screen.getByRole('status').textContent).toMatch(/^1 relay is on the default route because the proxy their rule names is down: ws:\/\/relay\.lan:4869\.$/);
    // With one key, the row names it rather than "All keys".
    expect(text(within(table()).getAllByRole('row')[1])).toContain(`${A} Public invoices`);
    expect(screen.queryByText('The proxies, and what each is carrying')).toBeNull();
    expect(cards()).toEqual([]);
  });

  it('says when no relay is listed, and when no proxy is in use', () => {
    show(base({ relays: [A] }, { list: [proxy('tor', 'tor')], rules: [] }), proxyPool({ routes: [] }));
    expect(screen.getByText('No relay is listed.')).toBeTruthy();
    expect(cards()).toEqual(['tor not checked socks5://tor:1 0 relays No rule points here Default route, 1 in order']);
  });
});
