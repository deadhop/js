// The Network tab's routing views, driven through the Settings page as an
// operator uses them: the map, each relay's route and why, the proxies'
// part in the default route, and the rules with their editor.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import Settings from './Settings.svelte';
import type { PayApi } from '../lib/api';
import type { ProxyPool, RouteState, Rule, Settings as S } from '../lib/schemas';
import { health, proxyPool, relayHistory, settings, settingsView } from '../test-helpers';

HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};

const ONION = 'ws://abc.onion';
const FIPS = 'ws://npub1x.fips:7777';
const LAN = 'ws://relay.lan:4869';
const A = 'wss://relay.contextvm.org';
const B = 'wss://bucket.coracle.social';
const C = 'wss://relay2.contextvm.org';
const RELAYS = [A, B, C, ONION, FIPS, LAN];

const proxy = (id: string, name: string) => ({ id, name, url: `socks5://${id}:1` });
const LIST = [proxy('tor', 'tor'), proxy('vpn', 'vpn-eu'), proxy('i2p', 'i2p')];
const GROUPS = [{ id: 'exits', name: 'Exits', proxies: ['tor', 'vpn'], strategy: 'failover' as const, rotate_secs: 3600, chaos_min_secs: 300, chaos_max_secs: 900 }];
const rule = (match: string[], to: Rule['to'], over: Partial<Rule> = {}): Rule => ({ name: '', match, keys: [], to, fallback: 'offline', ...over });
const RULES: Rule[] = [
  rule(['*.onion'], { proxy: 'tor' }),
  rule(['*.i2p'], { proxy: 'i2p' }),
  rule(['*.fips'], 'direct', { name: 'FIPS mesh' }),
  rule(['*.lan'], 'direct'),
  rule([A, C], { proxy: 'vpn' }, { fallback: { to: { group: 'exits' } } }),
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
const ph = (id: string, name: string, reachable: boolean | null) => ({ id, name, url: `socks5://${id}:1`, reachable, checked_at: 1, status: 'connected', reason: null });
/** A key on the default route `d`, using `active` now. */
const lane = (key: string, active: string | null, state: ProxyPool['state'] = 'active', d: ProxyPool['default'] = { group: 'exits' }) => ({
  key,
  default: d,
  state,
  active,
  reachable: 1,
  next_switch_at: null,
  uses_default: true,
  groups: typeof d === 'object' && 'group' in d ? [{ group: d.group, state, active, reachable: 1, next_switch_at: null }] : [],
});
const POOL = proxyPool({
  state: 'active',
  default: { group: 'exits' },
  active: 'tor',
  proxies: [ph('tor', 'tor', true), ph('vpn', 'vpn-eu', false), ph('i2p', 'i2p', null)],
  lanes: [lane('invoices', 'tor'), lane('admin', 'tor')],
  routes: ROUTES,
});

function base(over: Partial<S> = {}, proxies: Partial<S['proxies']> = {}): S {
  const s = settings({ relays: RELAYS, relay_keys: { [ONION]: ['invoices'] }, ...over });
  return { ...s, proxies: { ...s.proxies, list: LIST, groups: GROUPS, default: { group: 'exits' }, rules: RULES, ...proxies } };
}

function setup(view: 'routes' | 'relays' | 'proxies' | 'rules', s: S = base(), pool: ProxyPool | null = POOL, locked = false, dashboardRelays = [A]) {
  const v = settingsView({ settings: s, fixed: { ...settingsView().fixed, proxy_locked: locked } });
  const api = {
    getSettings: vi.fn().mockResolvedValue(v),
    updateSettings: vi.fn().mockResolvedValue(v),
    resetSettings: vi.fn(),
    checkProxy: vi.fn(),
    getRelayHistory: vi.fn().mockResolvedValue(relayHistory({ relays: [] })),
    getHealth: pool === null ? vi.fn().mockRejectedValue(new Error('down')) : vi.fn().mockResolvedValue(health({ proxy_pool: pool })),
  };
  render(Settings, { props: { api: api as unknown as PayApi, dashboardRelays, onChanged: vi.fn(), confirm: () => true, section: 'network', networkView: view } });
  return api;
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
const sent = (t: ReturnType<typeof setup>) => t.updateSettings.mock.calls.at(-1)![0];
/** An element's text with its pieces apart, as a reader sees them. */
const text = (el: Element) => {
  const parts: string[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) parts.push(walk.currentNode.textContent!);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};

describe('the routes view', () => {
  it('waits for the service, and switches views from its tabs', async () => {
    setup('routes', base(), null);
    expect(await screen.findByText('Reading the routes from the service…')).toBeTruthy();
    await fireEvent.click(screen.getByRole('tab', { name: /^Rules/ }));
    expect(screen.getByRole('tab', { name: /^Rules/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows every relay’s route, why, and what each proxy carries', async () => {
    setup('routes');
    const table = await screen.findByRole('table', { name: 'Route of every relay' });
    const rows = within(table).getAllByRole('row').slice(1).map(text);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toContain(`${A} All keys 5 ${A}, ${C} tor fallback: the rule’s proxy or group is down Internet through the proxy`);
    expect(rows[1]).toContain('· default route tor default route');
    expect(rows[3]).toContain('Public invoices 1 *.onion tor by the rule Tor hidden service');
    expect(rows[4]).toContain('Direct by the rule FIPS mesh');
    expect(rows[5]).toContain('This network');
    expect(screen.getByRole('status', { name: '' }).textContent).toBeTruthy();
    expect(screen.getByText(/2 relays are on their rule's fallback because the proxy or group the rule names is down/)).toBeTruthy();
    const tiles = [...document.querySelectorAll('.map-tile')].map(text);
    expect(tiles).toEqual(['Relays 6 Every relay has a route', 'Rules 5 1 match no relay yet', 'Proxies 3 1 down', 'Direct 2 None to the open internet']);
    const cards = [...document.querySelectorAll('.map-proxy')].map(text);
    expect(cards[0]).toContain('tor reachable socks5://tor:1 4 relays (2 as a fallback) Rule 1 points here In group Exits · on the default route');
    expect(cards[1]).toContain('vpn-eu down');
    expect(cards[2]).toContain('i2p not checked');
    expect(cards[2]).toContain('In no group');
    expect(cards[3]).toBe('Exits Failover tor → vpn-eu using tor On the default route');
    // One key at a time.
    await fireEvent.click(screen.getByLabelText('Administration'));
    expect(within(table).getAllByRole('row')).toHaveLength(6);
    await fireEvent.click(screen.getByLabelText('All keys'));
    expect(within(table).getAllByRole('row')).toHaveLength(7);
  });

  it('traces an address through the rules, per key when they differ', async () => {
    const rules = [rule(['*.onion'], { proxy: 'tor' }), rule(['x.example'], { group: 'exits' }), rule(['y.example'], 'direct'), rule(['z.example'], 'block', { keys: ['admin'] }), rule(['gone.example'], { proxy: 'gone' }), rule(['n.example'], { proxy: 'vpn' })];
    setup('routes', base({}, { rules, list: [proxy('tor', 'tor'), { ...proxy('vpn', ''), url: 'socks5://v:1' }] }));
    const box = await screen.findByLabelText('Try an address: which rule, which proxy?');
    const said = async (url: string) => {
      await fireEvent.input(box, { target: { value: url } });
      return [...document.querySelectorAll('.try-result')].map((e) => e.textContent);
    };
    expect(await said('ws://abc.onion')).toEqual(['Rule 1 matches (*.onion): tor']);
    expect(await said('wss://x.example')).toEqual(['Rule 2 matches (x.example): group exits']);
    expect(await said('wss://y.example')).toEqual(['Rule 3 matches (y.example): direct, no proxy']);
    expect(await said('wss://z.example')).toEqual(['Public invoices: No rule matches: the default route', 'Administration: Rule 4 matches (z.example): nowhere: blocked']);
    expect(await said('wss://gone.example')).toEqual(['Rule 5 matches (gone.example): a proxy that is no longer listed']);
    expect(await said('wss://n.example')).toEqual(['Rule 6 matches (n.example): socks5://v:1']);
    expect(await said('not an address')).toEqual([]);
  });

  it('warns about relays with no route, and copes with an empty list and an unknown proxy', async () => {
    const routes = [r('invoices', A, 1, 'off', null, 'proxy_down'), r('admin', A, 1, 'off', null, 'proxy_down'), r('invoices', B, null, 'proxy', 'ghost', 'default'), r('admin', B, null, 'proxy', 'tor', 'default')];
    setup('routes', base({ relays: [A, B] }, { rules: [rule([A], { proxy: 'tor' }), rule([B], { proxy: 'tor' })] }), proxyPool({ routes, proxies: [ph('tor', 'tor', false)] }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(`1 relay has no route now: ${A}.`);
    expect(screen.getByText('No connection')).toBeTruthy();
    expect(screen.getByText('ghost')).toBeTruthy();
    expect(text(document.querySelectorAll('.map-proxy')[0])).toContain('1 relay Rules 1, 2 point here');
    expect(text(document.querySelectorAll('.map-proxy')[1])).toContain('No rule points here');
    document.body.innerHTML = '';
    const two = [r('invoices', A, null, 'off', null, 'pool_offline'), r('invoices', B, null, 'off', null, 'pool_offline'), r('invoices', C, null, 'proxy', 'tor', 'fallback')];
    setup('routes', base({ relays: [A, B, C] }, { list: [], groups: [], default: 'direct', rules: [] }), proxyPool({ routes: two }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/^2 relays have no route now/);
    expect(screen.getByText(/^1 relay is on their rule's fallback/)).toBeTruthy();
    expect(screen.queryByText('The proxies, and what each is carrying')).toBeNull();
    document.body.innerHTML = '';
    setup('routes', base({ relays: [A] }), proxyPool({ routes: [] }));
    expect(await screen.findByText('No relay is listed.')).toBeTruthy();
  });
});

describe('the relays view', () => {
  it('shows each relay’s route, and why it goes that way, rule by rule', async () => {
    const routes = [...ROUTES.filter((x) => x.relay !== LAN), r('invoices', LAN, 4, 'direct', null, 'rule'), r('admin', LAN, null, 'off', null, 'blocked')];
    setup('relays', base({}, { rules: [...RULES.slice(0, 4), rule([A, C], { proxy: 'vpn' }, { fallback: { to: { group: 'exits' } }, keys: ['admin'] })] }), proxyPool({ ...POOL, routes }));
    await screen.findByText(A);
    const row = (url: string) => screen.getByText(url).closest('tr')!;
    await waitFor(() => expect(within(row(A)).getByText('tor')).toBeTruthy());
    expect(within(row(FIPS)).getByText('Direct')).toBeTruthy();
    expect(within(row(LAN)).getByText('Differs per key')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: `Why ${A} goes this way` }));
    const panel = screen.getByRole('region', { name: `Why ${A} goes this way` });
    const inv = within(panel).getByRole('list', { name: 'Rules checked for Public invoices' });
    expect([...inv.querySelectorAll('li')].map(text).at(-2)).toBe(`– 5 ${A}, ${C} not for Public invoices`);
    expect([...inv.querySelectorAll('li')].map(text).at(-1)).toBe('· No rule matched default route');
    const adm = within(panel).getByRole('list', { name: 'Rules checked for Administration' });
    expect([...adm.querySelectorAll('li')].map(text).at(-1)).toBe(`✓ 5 ${A}, ${C} matched: vpn-eu`);
    expect(within(panel).getAllByText('Now: tor, fallback: the rule’s proxy or group is down.')).toHaveLength(2);
    // Closing it, and going to the rules from it.
    await fireEvent.click(screen.getByRole('button', { name: `Why ${A} goes this way` }));
    expect(screen.queryByRole('region', { name: `Why ${A} goes this way` })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: `Why ${LAN} goes this way` }));
    const lan = screen.getByRole('region', { name: `Why ${LAN} goes this way` });
    expect(within(lan).getByText('Now: no connection, blocked by a rule or the default route.')).toBeTruthy();
    expect(within(lan).getByText('Now: direct, by the rule.')).toBeTruthy();
    await fireEvent.click(within(lan).getByRole('button', { name: 'Open the rules' }));
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeTruthy();
  });

  it('shows no route until the service answers', async () => {
    setup('relays', base(), null);
    await screen.findByText(A);
    expect(document.querySelector('.relay-edit .via-pill')).toBeNull();
  });

  it('says what the service has not reported, and traces with no rules at all', async () => {
    setup(
      'relays',
      base({ relays: [A, 'wss://new.example', C] }, { rules: [] }),
      proxyPool({ routes: [r('invoices', A, null, 'proxy', 'nobody', 'default'), r('admin', A, null, 'proxy', 'nobody', 'default'), r('invoices', C, null, 'off', null, 'pool_offline'), r('admin', C, null, 'off', null, 'pool_offline')] }),
    );
    await screen.findByText(A);
    await waitFor(() => expect(screen.getByText('socks5://nobody:1'.replace('socks5://nobody:1', 'nobody'))).toBeTruthy());
    expect(within(screen.getByText(C).closest('tr')!).getByText('No connection')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Why wss://new.example goes this way' }));
    const panel = screen.getByRole('region', { name: 'Why wss://new.example goes this way' });
    expect(within(panel).getAllByText('Not reported by the service yet.')).toHaveLength(2);
    expect(within(panel).getAllByText('No rules')).toHaveLength(2);
    await fireEvent.click(screen.getByRole('button', { name: `Why ${A} goes this way` }));
    expect(within(screen.getByRole('region', { name: `Why ${A} goes this way` })).getAllByText('Now: nobody, default route.')).toHaveLength(2);
  });

  it('previews the route of a relay before it is added', async () => {
    setup('relays', base({}, { rules: [...RULES, rule(['*.admin.example'], 'block', { keys: ['admin'] })] }));
    const add = await screen.findByLabelText('Add relay');
    await fireEvent.input(add, { target: { value: 'ws://x.b32.i2p' } });
    expect(screen.getByText('Before you add it: rule 2 (*.i2p) would match: i2p.')).toBeTruthy();
    await fireEvent.input(add, { target: { value: 'wss://plain.example' } });
    expect(screen.getByText('Before you add it: no rule matches: the default route.')).toBeTruthy();
    await fireEvent.input(add, { target: { value: 'wss://a.admin.example' } });
    expect(screen.getByText('Before you add it: Public invoices: no rule matches: the default route; Administration: rule 6 (*.admin.example) would match: nowhere: blocked.')).toBeTruthy();
    await fireEvent.input(add, { target: { value: 'nope' } });
    expect(screen.queryByText(/Before you add it/)).toBeNull();
  });
});

describe('the proxies view', () => {
  it('says what each proxy carries and what points at it, and makes a group', async () => {
    const t = setup('proxies', base({}, { default: { proxy: 'tor' } }));
    expect(await screen.findByText('Carries 0 relays now · used by group Exits, rule 5')).toBeTruthy();
    expect(screen.getByText('Carries 4 relays now · used by group Exits, rule 1, the default route')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    await save();
    await waitFor(() => expect(sent(t).proxies).toEqual({ groups: [GROUPS[0], { ...GROUPS[0], id: 'group-2', name: 'Group 2' }] }));
  });

  it('counts one relay and several rules', async () => {
    const list = [proxy('a', 'a')];
    const rules = [rule([A], { proxy: 'a' }), rule([B], { proxy: 'a' })];
    setup('proxies', base({ relays: [A, B] }, { list, groups: [], default: 'direct', rules }), proxyPool({ routes: [r('invoices', A, 1, 'proxy', 'a', 'rule')] }));
    expect(await screen.findByText('Carries 1 relay now · used by rule 1, rule 2')).toBeTruthy();
    expect(screen.getByText('Relays that no rule matches go to direct, no proxy. Change it under Rules, in the last row.')).toBeTruthy();
  });
});

describe('the rules view', () => {
  it('lists the rules with what each matches now, and the default route last', async () => {
    const rules = [rule(['*.contextvm.org'], { proxy: 'tor' }, { keys: ['admin'] }), rule([A], 'block', { keys: ['admin'] }), rule(['*.nothing'], { group: 'exits' }), ...RULES];
    setup('rules', base({}, { rules }));
    const list = await screen.findByRole('list', { name: 'Rules, in order' });
    const rows = [...list.querySelectorAll(':scope > li')].map(text);
    expect(rows[0]).toContain('*.contextvm.org Pattern on the host name tor Administration If down: stay offline, never connect another way Now: 2 relays');
    expect(rows[1]).toContain('Hidden by rule 1: never used');
    expect(rows[2]).toContain('Group Exits All keys If down: stay offline, never connect another way No relay yet');
    expect(rows[5]).toContain('FIPS mesh');
    expect(rows[6]).toContain(`Now: 1 relay, ${LAN}`);
    expect(rows[7]).toContain('These 2 relays, by address');
    expect(rows[7]).toContain('If down: Group Exits, then the offline policy');
    expect(rows.at(-1)).toContain('· Everything else Default route. Always last. Group Exits All keys If down: the offline policy (Kill switch) Now: 1 relay, wss://bucket.coracle.social');
  });

  it('edits the default route and a per-key one in the last row, and saves them', async () => {
    const t = setup('rules');
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit the default route' }));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Everything else goes' })).getByLabelText('Through tor'));
    await fireEvent.click(screen.getAllByLabelText('A different default route for this key')[1]);
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Everything else goes, for Administration' })).getByLabelText(/Group Exits/));
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(text(document.querySelector('.rule-row.default')!)).toContain('tor Every other key');
    await save();
    await waitFor(() => expect(sent(t).proxies).toEqual({ default: { proxy: 'tor' }, default_keys: { admin: { group: 'exits' } } }));
    await fireEvent.click(screen.getByRole('button', { name: 'Edit the default route' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Change the offline policy' }));
    expect(screen.getByRole('heading', { name: 'Proxies' })).toBeTruthy();
  });

  it('reorders and removes rules, and saves them', async () => {
    const t = setup('rules');
    await screen.findByRole('list', { name: 'Rules, in order' });
    expect((screen.getByRole('button', { name: 'Move rule 1 up' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move rule 5 down' }) as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Move rule 2 up' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Move rule 1 down' }));
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder rule 5 with the arrow keys' }), { key: 'ArrowUp' });
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder rule 1 with the arrow keys' }), { key: 'ArrowDown' });
    await fireEvent.keyDown(screen.getByRole('button', { name: 'Reorder rule 1 with the arrow keys' }), { key: 'Enter' });
    await fireEvent.click(screen.getByRole('button', { name: 'Remove rule 3' }));
    await save();
    await waitFor(() => expect(sent(t).proxies.rules.map((x: Rule) => x.match[0])).toEqual(['*.i2p', '*.onion', A, '*.lan']));
  });

  it('is read-only when the proxies are locked on the host', async () => {
    setup('rules', base({ relays: [A] }, { list: [], groups: [], default: 'direct', rules: [rule([A], 'direct')] }), proxyPool(), true);
    expect(await screen.findByText(/Rules can only be changed there/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'New rule' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove rule 1' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Edit the default route' }) as HTMLButtonElement).disabled).toBe(true);
    const last = [...document.querySelectorAll('.rule-row.default')].map(text)[0];
    expect(last).toContain('Direct, no proxy All keys Now: 0 relays');
  });
});

describe('the rule editor', () => {
  it('adds a pattern rule through a proxy, with a fallback, for one key, in a chosen place', async () => {
    const t = setup('rules');
    await fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    const editor = screen.getByRole('region', { name: 'New rule' }) ?? null;
    expect(editor).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Type at least one pattern.');
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: 'a b/c' } });
    expect(screen.getByRole('alert').textContent).toMatch(/may hold only/);
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: '*.coracle.social, extra.example' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Matches 1 of 6 relays.')).toBeTruthy();
    await fireEvent.click(screen.getByLabelText('Through vpn-eu'));
    expect(screen.getByText('4. If vpn-eu has nothing reachable')).toBeTruthy();
    await fireEvent.click(screen.getByLabelText(/Another destination/));
    await fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Fall back to' })).getByLabelText(/Group Exits/));
    // vpn-eu is down: the relay would fall back to the group, on tor, so nothing changes for it.
    expect(screen.getByText('No relay changes route.')).toBeTruthy();
    await fireEvent.click(screen.getByLabelText('This rule used by Administration'));
    await fireEvent.change(screen.getByLabelText('Place in the order'), { target: { selectedIndex: 0 } });
    await fireEvent.input(screen.getByLabelText('Name (optional)'), { target: { value: '  bucket  ' } });
    expect(screen.getByText(/Relays matching \*\.coracle\.social, extra\.example, for Public invoices, go to vpn-eu\./)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    expect(screen.queryByRole('region', { name: 'New rule' })).toBeNull();
    await save();
    await waitFor(() =>
      expect(sent(t).proxies.rules[0]).toEqual({ name: 'bucket', match: ['*.coracle.social', 'extra.example'], keys: ['invoices'], to: { proxy: 'vpn' }, fallback: { to: { group: 'exits' } } }),
    );
  });

  it('edits a rule by its relays, and keeps the change form-only until saved', async () => {
    setup('rules');
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit rule 5' }));
    expect(screen.getByRole('heading', { name: 'Rule 5' })).toBeTruthy();
    expect((screen.getByLabelText(A) as HTMLInputElement).checked).toBe(true);
    // Switching to a pattern and back keeps the ticked relays.
    await fireEvent.click(screen.getByLabelText('A pattern'));
    expect(screen.getByRole('alert').textContent).toBe('Type at least one pattern.');
    await fireEvent.click(screen.getByLabelText('Specific relays'));
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.click(screen.getByLabelText(A));
    await fireEvent.click(screen.getByLabelText(C));
    expect(screen.getByRole('alert').textContent).toBe('Tick at least one relay.');
    await fireEvent.click(screen.getByLabelText(B));
    await fireEvent.click(screen.getAllByLabelText(/Nowhere: block/)[0]);
    expect(screen.queryByText(/has nothing reachable$/)).toBeNull();
    // Each key's route changes the same way: one line.
    expect(text(document.querySelector('.rule-change')!)).toBe(`${B} tor → No connection`);
    await fireEvent.click(screen.getAllByLabelText(/Direct, no proxy/)[0]);
    await fireEvent.click(screen.getByLabelText(/I understand/));
    await fireEvent.click(screen.getByRole('button', { name: 'Update rule' }));
    expect(text([...document.querySelectorAll('.rule-row')][4])).toContain(`${B} This relay, by address Direct, no proxy`);
    await fireEvent.click(screen.getByRole('button', { name: 'Edit rule 1' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Rule 1' })).toBeNull();
  });

  it('asks before a relay is sent straight to the internet, and refuses a lockout', async () => {
    setup('rules');
    await fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: '*.coracle.social' } });
    await fireEvent.click(screen.getByLabelText(/Direct, no proxy/));
    expect(screen.getByText('This exposes your IP address')).toBeTruthy();
    const add = screen.getByRole('button', { name: 'Add rule' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await fireEvent.click(screen.getByLabelText(/I understand: this relay will see my IP address/));
    expect(add.disabled).toBe(false);
    await fireEvent.change(screen.getByLabelText('Place in the order'), { target: { selectedIndex: 0 } });
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: '*.contextvm.org' } });
    expect(screen.getByText(/these relays will see my IP address/)).toBeTruthy();
    expect(screen.getByText(/are internet relays/)).toBeTruthy();
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: 'relay.contextvm.org' } });
    await fireEvent.click(screen.getByLabelText(/Nowhere: block/));
    await fireEvent.change(screen.getByLabelText('Place in the order'), { target: { selectedIndex: 0 } });
    expect(screen.getByRole('alert').textContent).toBe('The rules block every relay this page signs in through for Administration: you would be locked out.');
    expect(add.disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: '*.onion' } });
    await fireEvent.click(screen.getByLabelText(/Direct, no proxy/));
    expect(screen.getByRole('alert').textContent).toBe('This rule: Tor and I2P relays can only be reached through a proxy, never directly.');
  });

  it('works out the preview from each key’s default route, and offers proxies not saved yet', async () => {
    const pool = proxyPool({ proxies: [ph('tor', 'tor', true)], lanes: [lane('invoices', null, 'direct', 'direct'), lane('admin', null, 'transparent', 'direct')] });
    setup('rules', base({ relays: [A, B], relay_keys: {} }, { rules: [], groups: [], default: 'direct', list: [proxy('tor', 'tor')] }), pool);
    await screen.findByRole('list', { name: 'Rules, in order' });
    await fireEvent.click(screen.getByRole('tab', { name: /^Proxies/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Create proxy' }));
    await fireEvent.input(screen.getByLabelText('Host'), { target: { value: '10.9.9.9' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add to list' }));
    await fireEvent.click(screen.getByRole('tab', { name: /^Rules/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'New rule' }));
    expect(screen.getByLabelText('Through socks5://10.9.9.9:9050')).toBeTruthy();
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: '*' } });
    await fireEvent.click(screen.getByLabelText('Through tor'));
    const lines = [...document.querySelectorAll('.rule-change')].map(text);
    expect(lines).toEqual([`${A} Direct → tor`, `${B} Direct → tor`]);
    // A key whose default route is offline, and one on a proxy no longer listed.
    document.body.innerHTML = '';
    setup(
      'rules',
      base({ relays: [A], relay_keys: {} }, { rules: [], groups: [], default: { proxy: 'ghost' }, list: [proxy('tor', 'tor')] }),
      proxyPool({ proxies: [ph('tor', 'tor', false)], lanes: [lane('invoices', 'ghost', 'active', { proxy: 'ghost' }), lane('admin', null, 'offline', { proxy: 'ghost' })] }),
    );
    await fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: '*' } });
    await fireEvent.click(screen.getByLabelText(/Direct, no proxy/));
    expect([...document.querySelectorAll('.rule-change')].map(text)).toEqual([`${A} Public invoices: ghost → Direct`, `${A} Administration: No connection → Direct`]);
    // Without a report from the service at all, every default route waits, off.
    document.body.innerHTML = '';
    setup('rules', base({ relays: [A], relay_keys: {} }, { rules: [], groups: [], default: 'block', list: [proxy('tor', 'tor')] }), null);
    await fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: '*' } });
    await fireEvent.click(screen.getByLabelText('Through tor'));
    expect([...document.querySelectorAll('.rule-change')].map(text)).toEqual([`${A} No connection → tor`]);
    await fireEvent.click(screen.getByLabelText('This rule used by Public invoices'));
    expect(screen.getByText(/for Administration, go to tor/)).toBeTruthy();
  });
});
