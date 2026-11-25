// The ordered rule list: what each rule matches now, reordering and removing
// (into the form), the editor for a new or changed rule, and the default route.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Rules from './Rules.svelte';
import { group, keyInfos, settings } from '../test-helpers';
import type { NetworkSettings, Rule } from '../lib/schemas';

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

function base(over: Partial<NetworkSettings> = {}, proxies: Partial<NetworkSettings['proxies']> = {}): NetworkSettings {
  const s = settings({ relays: RELAYS, relay_keys: { [ONION]: ['invoices'] }, ...over });
  return { ...s, proxies: { ...s.proxies, list: LIST, groups: GROUPS, default: { group: 'exits' }, rules: RULES, ...proxies } };
}

/** The view over a form; `form` is what the save bar would send. `refresh` shows the form as it is now. */
function setup(form: NetworkSettings = base(), locked = false) {
  const onproxies = vi.fn();
  const view = render(Rules, { props: { keys: keyInfos(), form, pool: null, dashboardRelays: [A], locked, onproxies } });
  const refresh = () => view.rerender({ form: { ...form } });
  return { form, onproxies, refresh };
}

const list = () => screen.getByRole('list', { name: 'Rules, in order' });
const text = (el: Element) => {
  const parts: string[] = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) parts.push(walk.currentNode.textContent!);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
};
const rows = () => [...list().querySelectorAll(':scope > li')].map(text);
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('Rules', () => {
  it('lists the rules with what each matches now, and the default route last', async () => {
    const rules = [rule(['*.contextvm.org'], { proxy: 'tor' }, { keys: ['admin'] }), rule([A], 'block', { keys: ['admin'] }), rule(['*.nothing'], { group: 'exits' }, { fallback: 'policy' }), ...RULES];
    setup(base({}, { rules }));
    const r = rows();
    expect(screen.getByText('8 of 32')).toBeTruthy();
    expect(r[0]).toContain('*.contextvm.org Pattern on the host name tor Administration If down: stay offline, never connect another way Now: 2 relays');
    expect(list().querySelector('.rule-down.bad')).toBeTruthy();
    expect(r[1]).toContain('Nowhere: blocked Administration Hidden by rule 1: never used');
    expect(r[2]).toContain('*.nothing Pattern on the host name Group Exits All keys If down: the offline policy decides No relay yet');
    expect(r[3]).toContain('*.onion Pattern on the host name tor All keys');
    expect(r[5]).toContain('*.fips FIPS mesh Direct, no proxy All keys');
    expect(r[6]).toContain(`Now: 1 relay, ${LAN}`);
    expect(r[7]).toContain('These 2 relays, by address vpn-eu All keys If down: Group Exits, then the offline policy');
    expect(r.at(-1)).toBe(`· Everything else Default route. Always last. Group Exits All keys If down: the offline policy (Kill switch) Now: 1 relay, ${B} Edit`);
    expect(list().querySelector('.via-pill.proxy-c1')).toBeTruthy();
    expect(list().querySelector('.via-pill.direct')).toBeTruthy();
    expect(list().querySelector('.via-pill.pool')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the per-key default routes on the last row, and edits the default route there', async () => {
    const t = setup(base({}, { default: 'block', default_keys: { admin: { proxy: 'tor' } } }));
    expect(rows().at(-1)).toBe(`· Everything else Default route. Always last. Nowhere: blocked Every other key Now: 1 relay, ${B} For the Administration key: tor Edit`);
    await fireEvent.click(button('Edit the default route'));
    expect(screen.getByRole('heading', { name: 'Everything else: the default route' })).toBeTruthy();
    expect(button('Edit the default route').disabled).toBe(true);
    await fireEvent.click(screen.getByRole('radiogroup', { name: 'Everything else goes' }).querySelector('input')!);
    expect(t.form.proxies.default).toEqual({ proxy: 'tor' });
    await fireEvent.click(button('Change the offline policy'));
    expect(t.onproxies).toHaveBeenCalledOnce();
    await fireEvent.click(button('Done'));
    expect(screen.queryByRole('heading', { name: 'Everything else: the default route' })).toBeNull();
  });

  it('reorders and removes rules in the form, by button and by arrow key', async () => {
    const t = setup();
    expect(button('Move rule 1 up').disabled).toBe(true);
    expect(button('Move rule 5 down').disabled).toBe(true);
    await fireEvent.click(button('Move rule 2 up'));
    expect(t.form.proxies.rules.map((x) => x.match[0])).toEqual(['*.i2p', '*.onion', '*.fips', '*.lan', A]);
    await t.refresh();
    await fireEvent.click(button('Move rule 1 down'));
    await t.refresh();
    await fireEvent.keyDown(button('Reorder rule 5 with the arrow keys'), { key: 'ArrowUp' });
    await t.refresh();
    await fireEvent.keyDown(button('Reorder rule 1 with the arrow keys'), { key: 'ArrowDown' });
    await t.refresh();
    await fireEvent.keyDown(button('Reorder rule 1 with the arrow keys'), { key: 'Enter' });
    expect(t.form.proxies.rules.map((x) => x.match[0])).toEqual(['*.i2p', '*.onion', '*.fips', A, '*.lan']);
    await fireEvent.click(button('Remove rule 3'));
    expect(t.form.proxies.rules.map((x) => x.match[0])).toEqual(['*.i2p', '*.onion', A, '*.lan']);
    await t.refresh();
    expect(screen.getByText('4 of 32')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove rule 5' })).toBeNull();
  });

  it('adds a rule from the editor in its chosen place, and edits one in place', async () => {
    const t = setup(base({}, { rules: [rule(['*.onion'], { proxy: 'tor' }), rule(['*.lan'], 'direct')] }));
    await fireEvent.click(button('New rule'));
    expect(screen.getByRole('heading', { name: 'New rule' })).toBeTruthy();
    // One editor at a time.
    expect(button('New rule').disabled).toBe(true);
    expect(button('Edit rule 1').disabled).toBe(true);
    await fireEvent.input(screen.getByLabelText(/Pattern on the relay's host name/), { target: { value: '*.coracle.social' } });
    await fireEvent.change(screen.getByLabelText('Place in the order'), { target: { selectedIndex: 1 } });
    await fireEvent.click(button('Add rule'));
    expect(screen.queryByRole('heading', { name: 'New rule' })).toBeNull();
    expect(t.form.proxies.rules.map((x) => x.match[0])).toEqual(['*.onion', '*.coracle.social', '*.lan']);
    expect(t.form.proxies.rules[1]).toEqual({ name: '', match: ['*.coracle.social'], keys: [], to: { group: 'exits' }, fallback: 'offline' });
    await t.refresh();
    await fireEvent.click(button('Edit rule 3'));
    expect(screen.getByRole('heading', { name: 'Rule 3' })).toBeTruthy();
    await fireEvent.change(screen.getByLabelText('Place in the order'), { target: { selectedIndex: 0 } });
    await fireEvent.click(button('Update rule'));
    expect(t.form.proxies.rules.map((x) => x.match[0])).toEqual(['*.lan', '*.onion', '*.coracle.social']);
    await t.refresh();
    await fireEvent.click(button('Edit rule 1'));
    await fireEvent.click(button('Cancel'));
    expect(screen.queryByRole('heading', { name: 'Rule 1' })).toBeNull();
    expect(t.form.proxies.rules).toHaveLength(3);
  });

  it('is read-only when locked on the host, and a direct default route has no fallback to tell', () => {
    setup(base({ relays: [A] }, { list: [], groups: [], default: 'direct', rules: [rule([A], 'direct')] }), true);
    expect(screen.getByRole('status').textContent).toMatch(/Rules can only be changed there/);
    for (const name of ['New rule', 'Remove rule 1', 'Edit rule 1', 'Reorder rule 1 with the arrow keys', 'Move rule 1 down', 'Edit the default route']) expect(button(name).disabled).toBe(true);
    expect(rows().at(-1)).toContain('Direct, no proxy All keys Now: 0 relays');
    expect(rows()[0]).toContain(`${A} This relay, by address Direct, no proxy All keys Now: 1 relay, ${A}`);
  });

  it('offers no new rule at the limit', () => {
    const rules = Array.from({ length: 32 }, (_, i) => rule([`r${i}.example`], { proxy: 'tor' }));
    setup(base({}, { rules }));
    expect(screen.getByText('32 of 32')).toBeTruthy();
    expect(button('New rule').disabled).toBe(true);
    expect(rows().at(-1)).toContain('Group Exits All keys If down: the offline policy (Kill switch) Now: 6 relays');
  });
});
