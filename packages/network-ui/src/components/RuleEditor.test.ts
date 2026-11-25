// The editor for one rule: which relays, for which keys, where they go, its
// place, and a preview of what it would change. It only hands the rule back.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import RuleEditor from './RuleEditor.svelte';
import { group, keyInfos, lane, proxyPool, settings } from '../test-helpers';
import { newRule } from '../lib/routes';
import type { KeyInfo, NetworkSettings, ProxyPool, Rule } from '../lib/schemas';

const ONION = 'ws://abc.onion';
const FIPS = 'ws://npub1x.fips:7777';
const LAN = 'ws://relay.lan:4869';
const A = 'wss://relay.contextvm.org';
const B = 'wss://bucket.coracle.social';
const C = 'wss://relay2.contextvm.org';
const RELAYS = [A, B, C, ONION, FIPS, LAN];

const proxy = (id: string, name: string) => ({ id, name, url: `socks5://${id}:1` });
const LIST = [proxy('tor', 'tor'), proxy('vpn', 'vpn-eu'), proxy('i2p', 'i2p')];
const GROUPS = [group('exits', ['tor', 'vpn'], { name: 'Exits' })];
const rule = (match: string[], to: Rule['to'], over: Partial<Rule> = {}): Rule => ({ name: '', match, keys: [], to, fallback: 'offline', ...over });
const RULES: Rule[] = [
  rule(['*.onion'], { proxy: 'tor' }),
  rule(['*.i2p'], { proxy: 'i2p' }),
  rule(['*.fips'], 'direct', { name: 'FIPS mesh' }),
  rule(['*.lan'], 'direct'),
  rule([A, C], { proxy: 'vpn' }, { fallback: { to: { group: 'exits' } } }),
];
const ph = (id: string, name: string, reachable: boolean | null) => ({ id, name, url: `socks5://${id}:1`, reachable, checked_at: 1, status: 'connected', reason: null });
const exits = (active: string | null) => ({ group: 'exits', state: active === null ? ('offline' as const) : ('active' as const), active, reachable: 1, next_switch_at: null });
const onExits = (key: string, active: string | null) => lane(key, { default: { group: 'exits' }, state: active === null ? 'offline' : 'active', active, groups: [exits(active)] });
const POOL = proxyPool({ state: 'active', default: { group: 'exits' }, active: 'tor', proxies: [ph('tor', 'tor', true), ph('vpn', 'vpn-eu', false), ph('i2p', 'i2p', null)], lanes: [onExits('invoices', 'tor'), onExits('admin', 'tor')] });

function base(over: Partial<NetworkSettings> = {}, proxies: Partial<NetworkSettings['proxies']> = {}): NetworkSettings {
  const s = settings({ relays: RELAYS, relay_keys: { [ONION]: ['invoices'] }, ...over });
  return { ...s, proxies: { ...s.proxies, list: LIST, groups: GROUPS, default: { group: 'exits' }, rules: RULES, ...proxies } };
}

interface Opts {
  rule?: Rule;
  index?: number | null;
  form?: NetworkSettings;
  pool?: ProxyPool | null;
  keys?: KeyInfo[];
}
function setup({ form = base(), rule: r = newRule(form.proxies), index = null, pool = POOL, keys = keyInfos() }: Opts = {}) {
  const onsave = vi.fn();
  const oncancel = vi.fn();
  render(RuleEditor, { props: { rule: r, index, keys, form, pool, dashboardRelays: [A], onsave, oncancel } });
  return { onsave, oncancel };
}

const text = (el: Element) => {
  const parts: string[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) parts.push(walk.currentNode.textContent!);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};
const changes = () => [...document.querySelectorAll('.rule-change')].map(text);
const pattern = (value: string) => fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value } });
const place = (selectedIndex: number) => fireEvent.change(screen.getByLabelText('Place in the order'), { target: { selectedIndex } });
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

const fallbackTo = () => screen.getByRole('radiogroup', { name: 'Fall back to' });

describe('RuleEditor', () => {
  it('makes a pattern rule through a proxy, with a fallback, for one key, in a chosen place', async () => {
    const t = setup();
    expect(screen.getByRole('heading', { name: 'New rule' })).toBeTruthy();
    expect(screen.getByText(/Relays matching …, for all keys, go to group exits\./)).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Type at least one pattern.');
    expect(button('Add rule').disabled).toBe(true);
    await pattern('a b/c');
    expect(screen.getByRole('alert').textContent).toMatch(/may hold only/);
    await pattern('*.coracle.social, extra.example');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Matches 1 of 6 relays.')).toBeTruthy();
    expect(screen.getByText('4. If Group Exits has nothing reachable')).toBeTruthy();
    expect(screen.getByText('Round-robin: tor, vpn-eu')).toBeTruthy();
    await fireEvent.click(screen.getByLabelText('Through vpn-eu'));
    expect(screen.getByText('4. If vpn-eu has nothing reachable')).toBeTruthy();
    // Staying offline, it goes through vpn-eu even while that is down (for both keys alike: one line).
    expect(changes()).toEqual([`${B} tor → vpn-eu`]);
    await fireEvent.click(screen.getByLabelText(/Follow the offline policy/));
    expect(screen.getByText('As the default route does. Now: Kill switch.')).toBeTruthy();
    expect(changes()).toEqual([`${B} tor → No connection`]);
    await fireEvent.click(screen.getByLabelText(/Another destination/));
    // Another destination: not vpn-eu itself, and not block; the first one left is picked.
    expect([...fallbackTo().querySelectorAll('label > span')].map((l) => l.firstChild!.textContent)).toEqual(['Through tor', 'Through i2p', 'Group Exits', 'Direct, no proxy']);
    expect((screen.getAllByLabelText('Through tor')[1] as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('No relay changes route.')).toBeTruthy();
    await fireEvent.click(screen.getAllByLabelText(/Group Exits/)[1]);
    await fireEvent.click(screen.getByLabelText('This rule used by Administration'));
    await place(0);
    expect((screen.getByLabelText('Place in the order') as HTMLSelectElement).options[5].textContent).toBe('6, last before the default route');
    await fireEvent.input(screen.getByLabelText('Name (optional)'), { target: { value: '  bucket  ' } });
    expect(screen.getByText(/Relays matching \*\.coracle\.social, extra\.example, for Public invoices, go to vpn-eu\./)).toBeTruthy();
    await fireEvent.click(button('Add rule'));
    expect(t.onsave).toHaveBeenCalledWith({ name: 'bucket', match: ['*.coracle.social', 'extra.example'], keys: ['invoices'], to: { proxy: 'vpn' }, fallback: { to: { group: 'exits' } } }, 0);
  });

  it('drops a fallback that becomes the destination, and keeps one that does not', async () => {
    const t = setup({ rule: rule([B], { proxy: 'vpn' }, { fallback: { to: { proxy: 'tor' } } }), index: null });
    await fireEvent.click(screen.getAllByLabelText('Through i2p')[0]);
    await fireEvent.click(button('Add rule'));
    expect(t.onsave).toHaveBeenLastCalledWith(expect.objectContaining({ to: { proxy: 'i2p' }, fallback: { to: { proxy: 'tor' } } }), 5);
    await fireEvent.click(screen.getAllByLabelText('Through tor')[0]);
    expect(screen.queryByRole('radiogroup', { name: 'Fall back to' })).toBeNull();
    expect((screen.getByLabelText(/Stay offline/) as HTMLInputElement).checked).toBe(true);
  });

  it('says plainly when a fallback can end in a direct connection', async () => {
    const open = base({}, { offline: 'open' });
    setup({ form: open, rule: rule(['*.coracle.social'], { group: 'exits' }, { fallback: 'policy' }) });
    expect(screen.getByRole('status').textContent).toMatch(/^While Group Exits has nothing reachable, the offline policy \(Carry on\) connects these relays straight/);
    await fireEvent.click(screen.getByLabelText(/Stay offline/));
    expect(screen.queryByRole('status')).toBeNull();
    await fireEvent.click(screen.getByLabelText(/Another destination/));
    await fireEvent.click(screen.getAllByLabelText(/Direct, no proxy/)[1]);
    expect(screen.getByRole('status').textContent).toMatch(/^While Group Exits has nothing reachable, these relays connect straight/);
    // Tor relays never fall back to a direct connection.
    await pattern('*.onion');
    expect(screen.getByRole('alert').textContent).toBe('This rule: Tor and I2P relays can only be reached through a proxy, never directly.');
  });

  it('edits a rule by its relays, and hands back the change', async () => {
    const t = setup({ rule: RULES[4], index: 4 });
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
    expect(changes()).toEqual([`${B} tor → No connection`]);
    await fireEvent.click(screen.getAllByLabelText(/Group Exits/)[0]);
    await fireEvent.click(button('Update rule'));
    // A rule is saved with the fallback it shows: the one from before, unless it was the same destination.
    expect(t.onsave).toHaveBeenCalledWith({ name: '', match: [B], keys: [], to: { group: 'exits' }, fallback: 'offline' }, 4);
    await fireEvent.click(button('Cancel'));
    expect(t.oncancel).toHaveBeenCalledOnce();
  });

  it('opens a pattern rule as patterns, keeping only its patterns', () => {
    setup({ rule: rule(['*.onion', A], 'direct'), index: 0 });
    expect((screen.getByLabelText(/Pattern on the relay's host name/) as HTMLInputElement).value).toBe('*.onion');
  });

  it('asks before a relay is sent straight to the internet, and refuses a lockout', async () => {
    setup();
    await pattern('*.coracle.social');
    await fireEvent.click(screen.getByLabelText(/Direct, no proxy/));
    expect(screen.getByText('This exposes your IP address')).toBeTruthy();
    expect(screen.getByText(/is an internet relay\. Connected directly, it sees/)).toBeTruthy();
    expect(button('Add rule').disabled).toBe(true);
    await fireEvent.click(screen.getByLabelText(/I understand: this relay will see my IP address/));
    expect(button('Add rule').disabled).toBe(false);
    await place(0);
    await pattern('*.contextvm.org');
    expect(screen.getByText(/these relays will see my IP address/)).toBeTruthy();
    expect(screen.getByText(/are internet relays\. Connected directly, they see/)).toBeTruthy();
    await pattern('relay.contextvm.org');
    await fireEvent.click(screen.getByLabelText(/Nowhere: block/));
    await place(0);
    expect(screen.getByRole('alert').textContent).toBe('The rules block every relay this page signs in through for Administration: you would be locked out.');
    expect(button('Add rule').disabled).toBe(true);
    await pattern('*.onion');
    await fireEvent.click(screen.getByLabelText(/Direct, no proxy/));
    expect(screen.getByRole('alert').textContent).toBe('This rule: Tor and I2P relays can only be reached through a proxy, never directly.');
  });

  it('offers every listed proxy and group, saved or not, and previews from each key’s default route', async () => {
    const pool = proxyPool({ proxies: [ph('tor', 'tor', true)], lanes: [lane('invoices'), lane('admin', { state: 'transparent' })] });
    const form = base({ relays: [A, B], relay_keys: {} }, { rules: [], default: 'direct', groups: [], list: [proxy('tor', 'tor'), { ...proxy('pnew', ''), url: 'socks5://10.9.9.9:1080' }] });
    setup({ form, pool });
    expect(screen.getByLabelText('Through socks5://10.9.9.9:1080')).toBeTruthy();
    await pattern('*');
    await fireEvent.click(screen.getByLabelText('Through tor'));
    expect(changes()).toEqual([`${A} Direct → tor`, `${B} Direct → tor`]);
  });

  it('names a key whose default route is offline, and one on a proxy no longer listed', async () => {
    const pool = proxyPool({ proxies: [ph('tor', 'tor', false)], lanes: [lane('invoices', { default: { proxy: 'ghost' }, active: 'ghost', state: 'active' }), lane('admin', { default: { group: 'exits' }, state: 'offline' })] });
    setup({ form: base({ relays: [A], relay_keys: {} }, { rules: [], default: { proxy: 'ghost' }, default_keys: { admin: { group: 'exits' } } }), pool });
    await pattern('*');
    await fireEvent.click(screen.getByLabelText(/Direct, no proxy/));
    expect(changes()).toEqual([`${A} Public invoices: ghost → Direct`, `${A} Administration: No connection → Direct`]);
  });

  it('counts every default route as waiting without a report, and names no key when there is one', async () => {
    setup({ form: base({ relays: [A], relay_keys: {} }, { rules: [], list: [proxy('tor', 'tor')], groups: [group('exits', ['tor', 'tor2'])] }), pool: null, keys: keyInfos().slice(0, 1) });
    expect(screen.queryByRole('group', { name: /used by/ })).toBeNull();
    await pattern('*');
    await fireEvent.click(screen.getByLabelText('Through tor'));
    expect(changes()).toEqual([]);
    await fireEvent.click(screen.getByLabelText(/Direct, no proxy/));
    expect(changes()).toEqual([`${A} tor → Direct`]);
  });
});
