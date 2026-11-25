// The default route, the last rule: where relays no rule matches go, for
// every key and per key, edited in the form in place.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import DefaultRoute from './DefaultRoute.svelte';
import type { ProxySettings } from '../lib/schemas';
import { group, keyInfos, settings } from '../test-helpers';

const LIST = [
  { id: 'tor', name: 'Tor', url: 'socks5://tor:1' },
  { id: 'vpn', name: 'VPN', url: 'socks5://vpn:1' },
];

function setup(over: Partial<ProxySettings> = {}) {
  const proxies: ProxySettings = $state({ ...settings().proxies, list: LIST, groups: [group('exits', ['tor', 'vpn'], { name: 'Exits', strategy: 'chaos' })], ...over });
  const ondone = vi.fn();
  const onproxies = vi.fn();
  render(DefaultRoute, { props: { keys: keyInfos(), proxies, ondone, onproxies } });
  return { proxies, ondone, onproxies };
}

const choices = (name: string) => screen.getByRole('radiogroup', { name });
const alerts = () => screen.queryAllByRole('status').map((s) => s.textContent);

describe('DefaultRoute', () => {
  it('points every key at a proxy, a group, direct or block', async () => {
    const t = setup({ default: { proxy: 'tor' } });
    const all = choices('Everything else goes');
    expect(within(all).getAllByRole('radio')).toHaveLength(5);
    expect((within(all).getByLabelText('Through Tor') as HTMLInputElement).checked).toBe(true);
    expect(within(all).getByText('Chaos: Tor, VPN')).toBeTruthy();
    expect(screen.getByText(/^The offline policy decides: now Kill switch\./)).toBeTruthy();
    expect(alerts()).toEqual([]);
    await fireEvent.click(within(all).getByLabelText(/Group Exits/));
    expect(t.proxies.default).toEqual({ group: 'exits' });
    await fireEvent.click(within(all).getByLabelText(/Direct, no proxy/));
    expect(t.proxies.default).toBe('direct');
    expect(alerts()).toEqual(['These relays connect straight: they see this machine’s IP address.']);
    await fireEvent.click(within(all).getByLabelText(/Nowhere: block/));
    expect(t.proxies.default).toBe('block');
    expect(screen.getByText('Blocked for Public invoices, Administration: only the relays a rule sends somewhere connect.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(t.ondone).toHaveBeenCalledOnce();
    await fireEvent.click(screen.getByRole('button', { name: 'Change the offline policy' }));
    expect(t.onproxies).toHaveBeenCalledOnce();
  });

  it('gives one key a default route of its own, and takes it back', async () => {
    const t = setup({ default: { group: 'exits' }, offline: 'admin_only' });
    // The offline policy may connect straight for some keys.
    expect(alerts()).toEqual([expect.stringMatching(/^While Group Exits has nothing reachable, the offline policy \(Operators only\) connects/)]);
    expect(screen.queryByRole('radiogroup', { name: 'Everything else goes, for Administration' })).toBeNull();
    await fireEvent.click(screen.getAllByLabelText('A different default route for this key')[1]);
    expect(t.proxies.default_keys).toEqual({ admin: { group: 'exits' } });
    await fireEvent.click(within(choices('Everything else goes, for Administration')).getByLabelText('Through VPN'));
    expect(t.proxies.default_keys).toEqual({ admin: { proxy: 'vpn' } });
    expect(alerts()).toHaveLength(2);
    await fireEvent.click(within(choices('Everything else goes, for Administration')).getByLabelText(/Nowhere: block/));
    expect(screen.getByText('Blocked for Administration: only the relays a rule sends somewhere connect.')).toBeTruthy();
    await fireEvent.click(screen.getAllByLabelText('A different default route for this key')[1]);
    expect(t.proxies.default_keys).toEqual({});
  });
});
