import type { RelayHealth } from '../lib/schemas';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import Network from './Network.svelte';
import type { ConsoleApi } from '../lib/api';
import { health, proxyCheck, relayHistory, relayStats, settings, networkView } from '../test-helpers';

// jsdom has <dialog> but not its modal methods.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

function setup(view = networkView(), over: Record<string, ReturnType<typeof vi.fn>> = {}, answer = true, pageRelays = ['ws://127.0.0.1:7777']) {
  const api = {
    getNetwork: vi.fn().mockResolvedValue(view),
    updateNetwork: vi.fn().mockResolvedValue(view),
    checkProxy: vi.fn().mockResolvedValue(proxyCheck()),
    getRelayHistory: vi.fn().mockResolvedValue(relayHistory({ relays: [] })),
    getHealth: vi.fn().mockResolvedValue(health()),
    ...over,
  };
  const confirm = vi.fn().mockReturnValue(answer);
  render(Network, { props: { api: api as unknown as ConsoleApi, pageRelays, confirm, networkView: 'relays' } });
  return { ...api, confirm };
}

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

describe('Network', () => {
  it("shows each relay's error rate for the last day, and leaves it out when it cannot be read", async () => {
    const history = relayHistory({ relays: [relayStats({ relay: 'ws://127.0.0.1:7777/', checks: 10, check_failures: 0, sends: 30, send_failures: 1 })] });
    setup(networkView(), { getRelayHistory: vi.fn().mockResolvedValue(history) });
    expect((await screen.findByText('2.5% errors · 24 h')).className).toBe('rate-chip warn');

    document.body.innerHTML = '';
    setup(networkView(), { getRelayHistory: vi.fn().mockRejectedValue(new Error('unauthorized')) });
    await screen.findByText('ws://127.0.0.1:7777');
    expect(screen.queryByText(/errors · 24 h/)).toBeNull();
  });

  it('says on the Network tab that saving may reconnect, and discards a new relay', async () => {
    setup();
    await screen.findByText('No unsaved changes.');
    await fireEvent.input(screen.getByLabelText('Add relay'), { target: { value: 'wss://new.example' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('1 change')).toBeTruthy();
    expect(screen.getByText('Relays or proxies changed: saving may reconnect the service.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByText('wss://new.example')).toBeNull();
  });

  it('adds relays, and will not remove the one this page connects through', async () => {
    const t = setup(networkView(), {}, false);
    await screen.findByText('ws://127.0.0.1:7777');
    expect((screen.getByRole('button', { name: 'Remove ws://127.0.0.1:7777' }) as HTMLButtonElement).disabled).toBe(true);
    const add = screen.getByLabelText('Add relay');
    await fireEvent.input(add, { target: { value: 'https://nope' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toContain('starts with wss://');
    await fireEvent.input(add, { target: { value: 'ws://127.0.0.1:7777' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toContain('already listed');
    await fireEvent.input(add, { target: { value: 'wss://relay.example' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.queryByRole('alert')).toBeNull();

    // Administration cannot be switched off on the only relay this page uses.
    expect((screen.getByLabelText('ws://127.0.0.1:7777 used by Administration') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('wss://relay.example used by Administration') as HTMLInputElement).disabled).toBe(false);

    // Removing it asks for a replacement, and there is none this page could use.
    await fireEvent.click(screen.getByRole('button', { name: 'Remove ws://127.0.0.1:7777' }));
    expect(screen.getByText(/cannot be removed/)).toBeTruthy();
    expect(screen.getByText(/would lock you out/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Replace and remove' })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByText(/would lock you out/)).toBeNull();
    expect(screen.getByText('ws://127.0.0.1:7777')).toBeTruthy();

    await save();
    expect(t.confirm).toHaveBeenCalledWith(expect.stringContaining('reconnect'));
    expect(t.updateNetwork).not.toHaveBeenCalled();
  });

  it('refuses a relay beside the box it was typed in, with the reason, and takes Tor, I2P and FIPS ones on mainnet', async () => {
    const mainnet = networkView({ chain: 'bitcoin' });
    setup(mainnet);
    await screen.findByText('ws://127.0.0.1:7777');
    const add = screen.getByLabelText('Add relay');
    await fireEvent.input(add, { target: { value: 'ws://relay.example' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('On mainnet a relay must use wss://');
    expect(alert.id).toBe('relay-error');
    expect(add.getAttribute('aria-invalid')).toBe('true');
    expect(add.getAttribute('aria-describedby')).toBe('relay-error');
    expect(screen.queryByText('ws://relay.example')).toBeNull();
    // Typing again clears it.
    await fireEvent.input(add, { target: { value: 'ws://abc.onion' } });
    expect(screen.queryByRole('alert')).toBeNull();
    for (const url of ['ws://abc.onion', 'ws://node.b32.i2p', 'ws://npub1abc.fips:7777']) {
      await fireEvent.input(add, { target: { value: url } });
      await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
      expect(screen.getByText(url)).toBeTruthy();
    }
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows each relay\'s last check, and tests them all again on request', async () => {
    const check = (relay: string, over: Partial<RelayHealth>): RelayHealth => ({ relay, status: 'ok', connects: true, forwards: true, rate_limited: false, ms: 120, detail: '', checked_at: 1, ...over });
    const relays = ['ws://127.0.0.1:7777', 'wss://b.example', 'wss://c.example'];
    const before = health({
      relay_health: [
        check('ws://127.0.0.1:7777/', {}),
        check('wss://b.example', { status: 'degraded', forwards: null, rate_limited: true, ms: null, detail: 'rate-limited' }),
        check('wss://c.example', { status: 'down', connects: false, forwards: false, ms: null, detail: 'connection refused' }),
      ],
    });
    const after = health({ relay_health: [check('ws://127.0.0.1:7777', { ms: 80 })] });
    const getHealth = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after);
    const checkRelays = vi.fn().mockResolvedValueOnce({ relays: [] }).mockRejectedValue(new Error('Too many requests. Wait a minute and try again.'));
    setup(networkView({ settings: settings({ relays }) }), { getHealth, checkRelays });
    const line = (r: string) => screen.findByRole('status', { name: `${r}: last check` });
    expect((await line(relays[0])).textContent).toContain('connects · carries events · 120 ms');
    expect((await line(relays[1])).textContent).toContain('connects · rate-limiting us');
    expect((await line(relays[1])).textContent).toContain('rate-limited');
    expect((await line(relays[2])).textContent).toContain('does not connect · does not carry events');
    expect((await line(relays[2])).textContent).toContain('connection refused');
    await fireEvent.click(screen.getByRole('button', { name: 'Test relays' }));
    await waitFor(() => expect(checkRelays).toHaveBeenCalledTimes(1));
    expect((await line(relays[0])).textContent).toContain('80 ms');
    expect(screen.queryByRole('status', { name: `${relays[2]}: last check` })).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Test relays' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Too many requests. Wait a minute and try again.'));
    expect((screen.getByRole('button', { name: 'Test relays' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('forgets a refused change when it is discarded', async () => {
    const list = [
      { id: 'a', name: '', url: 'socks5://h:1' },
      { id: 'b', name: '', url: 'socks5://h:2' },
    ];
    setup(networkView({ settings: settings({ proxies: { ...settings().proxies, list } }) }));
    await fireEvent.click(await screen.findByRole('tab', { name: /^Proxies/ }));
    await fireEvent.click(await screen.findByRole('button', { name: 'New group' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Take socks5://h:2 out of Group 1' }));
    await save();
    expect(document.querySelector('.save-text.failed')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByText('No unsaved changes.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says in the save bar when a save was refused, with the service\'s reason', async () => {
    const reason = "The service rejected the request as invalid. (relay 'ws://x' must use wss:// on mainnet)";
    setup(networkView(), { updateNetwork: vi.fn().mockRejectedValue(new Error(reason)) });
    await screen.findByText('ws://127.0.0.1:7777');
    await fireEvent.input(screen.getByLabelText('Add relay'), { target: { value: 'wss://new.example' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await save();
    await waitFor(() => expect(document.querySelector('.save-text.failed')!.textContent).toBe(`Not saved. ${reason}`));
    expect(screen.getByRole('alert').textContent).toBe(reason);
  });

  it("asks which relay takes over when a key's only relay is removed, and moves the key there", async () => {
    const t = setup(
      networkView({
        settings: settings({ relays: ['ws://127.0.0.1:7777', 'wss://a.example', 'wss://b.example'], relay_keys: { 'ws://127.0.0.1:7777': ['admin'], 'wss://b.example': ['admin'] } }),
      }),
    );
    await screen.findByText('wss://a.example');
    // a.example is the public invoices key's only relay.
    expect((screen.getByLabelText('wss://a.example used by Public invoices') as HTMLInputElement).disabled).toBe(true);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove wss://a.example' }));
    expect(screen.getByText(/Public invoices has no other relay/)).toBeTruthy();
    await fireEvent.click(screen.getByLabelText('wss://b.example'));
    await fireEvent.click(screen.getByRole('button', { name: 'Replace and remove' }));
    expect(screen.queryByText('wss://a.example')).toBeNull();
    await save();
    await waitFor(() =>
      expect(t.updateNetwork).toHaveBeenCalledWith({ relays: ['ws://127.0.0.1:7777', 'wss://b.example'], relay_keys: { 'ws://127.0.0.1:7777': ['admin'] } }),
    );
  });

  it("moves the administration key to another of this page's relays, adding it when it is not listed", async () => {
    const t = setup(networkView(), {}, true, ['ws://127.0.0.1:7777', 'wss://page.example']);
    await screen.findByText('ws://127.0.0.1:7777');
    await fireEvent.input(screen.getByLabelText('Add relay'), { target: { value: 'wss://relay.example' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove ws://127.0.0.1:7777' }));
    expect(screen.getByText(/Administration needs a relay that this page connects through/)).toBeTruthy();
    expect(screen.getByText('not listed: it will be added')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Replace and remove' }));
    await save();
    await waitFor(() => expect(t.updateNetwork).toHaveBeenCalledWith({ relays: ['wss://relay.example', 'wss://page.example'] }));
  });

  it('still asks before saving when the saved relays already leave this page without the administration key', async () => {
    const t = setup(networkView({ settings: settings({ relays: ['wss://a.example'] }) }), {}, false);
    await screen.findByText('wss://a.example');
    expect(screen.getByRole('alert').textContent).toContain('This page signs in through the administration key');
    await fireEvent.input(screen.getByLabelText('Add relay'), { target: { value: 'wss://b.example' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await save();
    expect(t.confirm).toHaveBeenCalledWith(expect.stringContaining('would no longer use any of them'));
    expect(t.updateNetwork).not.toHaveBeenCalled();
  });

  it('closes the replacement dialog on Escape', async () => {
    setup(networkView({ settings: settings({ relays: ['ws://127.0.0.1:7777', 'wss://a.example'], relay_keys: { 'ws://127.0.0.1:7777': ['admin'] } }) }));
    await screen.findByText('wss://a.example');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove wss://a.example' }));
    expect(screen.getByText(/Public invoices has no other relay/)).toBeTruthy();
    await fireEvent(document.querySelector('dialog')!, new Event('cancel'));
    expect(screen.queryByText(/Public invoices has no other relay/)).toBeNull();
  });

  it('removes a relay that no key depends on without asking', async () => {
    setup(networkView({ settings: settings({ relays: ['ws://127.0.0.1:7777', 'wss://a.example'] }) }));
    await screen.findByText('wss://a.example');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove wss://a.example' }));
    expect(screen.queryByRole('button', { name: 'Replace and remove' })).toBeNull();
    expect(screen.queryByText('wss://a.example')).toBeNull();
  });

  it('explains each key, with how many relays it uses and where everything else goes', async () => {
    setup(networkView({ settings: settings({ relays: ['ws://127.0.0.1:7777', 'wss://b.example'], relay_keys: { 'wss://b.example': ['invoices'] } }) }));
    const keys = await screen.findByRole('list', { name: 'Keys' });
    const lines = [...keys.querySelectorAll('li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(lines[0]).toContain('Public invoices');
    expect(lines[0]).toContain('2 relays · everything else: direct, no proxy');
    expect(lines[1]).toContain('Administration');
    expect(lines[1]).toContain('Operators sign in here');
    expect(lines[1]).toContain('1 relay · everything else: direct, no proxy');
  });

  it("names each key's default route", async () => {
    const proxies = { ...settings().proxies, list: [{ id: 'a', name: 'tor', url: 'socks5://h:1' }], default: { proxy: 'a' }, default_keys: { admin: 'block' as const } };
    setup(networkView({ settings: settings({ proxies }) }));
    const keys = await screen.findByRole('list', { name: 'Keys' });
    expect([...keys.querySelectorAll('.count')].map((c) => c.textContent)).toEqual(['1 relay · everything else: tor', '1 relay · everything else: nowhere: blocked']);
  });

  describe('which key uses which relay', () => {
    const two = () => networkView({ settings: settings({ relays: ['ws://127.0.0.1:7777', 'wss://b.example'] }) });
    const chip = (relay: string, key: string) => screen.getByLabelText(`${relay} used by ${key}`) as HTMLInputElement;

    it('starts with every key on every relay, and saves only the restricted ones', async () => {
      const t = setup(two());
      await screen.findByText('wss://b.example');
      expect(chip('wss://b.example', 'Administration').checked && chip('wss://b.example', 'Public invoices').checked).toBe(true);
      expect(screen.getAllByText('all keys')).toHaveLength(2);
      await fireEvent.click(chip('wss://b.example', 'Administration'));
      expect(screen.getByText('1 change')).toBeTruthy();
      expect(screen.getByText('Relays or proxies changed: saving may reconnect the service.')).toBeTruthy();
      expect(screen.getAllByText('all keys')).toHaveLength(1);
      await save();
      await waitFor(() => expect(t.updateNetwork).toHaveBeenCalledWith({ relay_keys: { 'wss://b.example': ['invoices'] } }));
      expect(t.confirm).toHaveBeenCalledWith(expect.stringContaining('reconnect'));
    });

    it('does not save a restriction when the reconnect is not confirmed', async () => {
      const t = setup(two(), {}, false);
      await screen.findByText('wss://b.example');
      await fireEvent.click(chip('wss://b.example', 'Administration'));
      await save();
      expect(t.confirm).toHaveBeenCalledWith(expect.stringContaining('reconnect'));
      expect(t.updateNetwork).not.toHaveBeenCalled();
    });

    it('does not let a relay lose its last key', async () => {
      setup(two());
      await screen.findByText('wss://b.example');
      await fireEvent.click(chip('wss://b.example', 'Administration'));
      expect(chip('wss://b.example', 'Public invoices').disabled).toBe(true);
    });

    it('going back to all keys is no change', async () => {
      setup(two());
      await screen.findByText('wss://b.example');
      await fireEvent.click(chip('wss://b.example', 'Administration'));
      await fireEvent.click(chip('wss://b.example', 'Administration'));
      expect(screen.getByText('No unsaved changes.')).toBeTruthy();
    });

    it('refuses, before asking the service, to leave a key with no relay', async () => {
      const t = setup(two());
      await screen.findByText('wss://b.example');
      await fireEvent.click(chip('wss://b.example', 'Administration'));
      await fireEvent.click(chip('ws://127.0.0.1:7777', 'Administration'));
      expect(screen.getByText('No relay is assigned to Administration: it could not be reached. Give it one.')).toBeTruthy();
      await save();
      expect(screen.getAllByRole('alert').map((a) => a.textContent).join(' ')).toContain('No relay is assigned to Administration');
      expect(t.updateNetwork).not.toHaveBeenCalled();
    });

    it('lets an assignment that cannot be saved be discarded', async () => {
      setup(two());
      await screen.findByText('wss://b.example');
      await fireEvent.click(chip('wss://b.example', 'Administration'));
      await fireEvent.click(chip('ws://127.0.0.1:7777', 'Administration'));
      const discard = screen.getByRole('button', { name: 'Discard' }) as HTMLButtonElement;
      expect(discard.disabled).toBe(false);
      await fireEvent.click(discard);
      expect(screen.getByText('No unsaved changes.')).toBeTruthy();
    });

    it('warns, without blocking, when the administration key would lose this page', async () => {
      const t = setup(two());
      await screen.findByText('wss://b.example');
      await fireEvent.click(chip('ws://127.0.0.1:7777', 'Administration'));
      expect(screen.getByRole('alert').textContent).toContain('signs in through the administration key');
      await save();
      expect(t.confirm).toHaveBeenCalledWith(expect.stringContaining('administration key would no longer use'));
      await waitFor(() => expect(t.updateNetwork).toHaveBeenCalledWith({ relay_keys: { 'ws://127.0.0.1:7777': ['invoices'] } }));
    });

    it('forgets a restriction when its relay is removed', async () => {
      const view = networkView({ settings: settings({ relays: ['ws://127.0.0.1:7777', 'wss://b.example'], relay_keys: { 'wss://b.example': ['invoices'] } }) });
      const t = setup(view);
      await screen.findByText('wss://b.example');
      await fireEvent.click(screen.getByRole('button', { name: 'Remove wss://b.example' }));
      await save();
      await waitFor(() => expect(t.updateNetwork).toHaveBeenCalledWith({ relays: ['ws://127.0.0.1:7777'], relay_keys: {} }));
    });

    it('refuses a default route that blocks every relay of a key', async () => {
      const t = setup(networkView());
      await fireEvent.click(await screen.findByRole('tab', { name: /^Rules/ }));
      await fireEvent.click(await screen.findByRole('button', { name: 'Edit the default route' }));
      await fireEvent.click(screen.getAllByLabelText(/Nowhere: block/)[0]);
      expect(screen.getByText('The rules and the default route block every relay of Public invoices: it could not be reached.')).toBeTruthy();
      await save();
      expect(t.updateNetwork).not.toHaveBeenCalled();
    });
  });

  it('caps the relay list at eight', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => `wss://r${i}.example`);
    setup(networkView({ settings: settings({ relays: eight }) }));
    await screen.findByText('wss://r7.example');
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });


  describe('relay names', () => {
    const name = (relay: string) => screen.getByLabelText(`Name of ${relay}`) as HTMLInputElement;

    it('names a relay and saves only the name, without asking: names never reconnect', async () => {
      const t = setup();
      await screen.findByText('ws://127.0.0.1:7777');
      expect(name('ws://127.0.0.1:7777').value).toBe('');
      await fireEvent.input(name('ws://127.0.0.1:7777'), { target: { value: ' Home relay ' } });
      expect(screen.getByText('1 change')).toBeTruthy();
      expect(screen.getByText('Saved as an override on top of the environment.')).toBeTruthy();
      await save();
      await waitFor(() => expect(t.updateNetwork).toHaveBeenCalledWith({ relay_names: { 'ws://127.0.0.1:7777': 'Home relay' } }));
      expect(t.confirm).not.toHaveBeenCalled();
      expect(await screen.findByText('Saved.')).toBeTruthy();
    });

    it('clears a name, and an empty name is no change', async () => {
      const t = setup(networkView({ settings: settings({ relay_names: { 'ws://127.0.0.1:7777': 'Home' } }) }));
      await screen.findByText('ws://127.0.0.1:7777');
      expect(name('ws://127.0.0.1:7777').value).toBe('Home');
      await fireEvent.input(name('ws://127.0.0.1:7777'), { target: { value: '  ' } });
      await save();
      await waitFor(() => expect(t.updateNetwork).toHaveBeenCalledWith({ relay_names: {} }));
      document.body.innerHTML = '';
      setup();
      await screen.findByText('ws://127.0.0.1:7777');
      await fireEvent.input(name('ws://127.0.0.1:7777'), { target: { value: ' ' } });
      expect(screen.getByText('No unsaved changes.')).toBeTruthy();
    });
  });

  it('says when there is nothing to save', async () => {
    const t = setup();
    await screen.findByText('ws://127.0.0.1:7777');
    await save();
    expect(screen.getByText('Nothing to save.')).toBeTruthy();
    expect(t.updateNetwork).not.toHaveBeenCalled();
  });

  it('shows what is overridden, the warnings and a pending reconnect', async () => {
    setup(networkView({ overridden: ['relays', 'relay_names'], warnings: ['no proxy in use'], restart_pending: true }));
    expect(await screen.findByText('2 overridden')).toBeTruthy();
    expect(screen.getByText('no proxy in use')).toBeTruthy();
    expect(screen.getByText('Reconnecting to the relays…')).toBeTruthy();
  });

  it('says why the settings could not be read', async () => {
    setup(networkView(), { getNetwork: vi.fn().mockRejectedValue(new Error('This key is not an operator of this service.')) });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This key is not an operator of this service.'));
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it('asks the browser to confirm by default', async () => {
    const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const api = {
      getNetwork: vi.fn().mockResolvedValue(networkView()),
      updateNetwork: vi.fn(),
      getRelayHistory: vi.fn().mockResolvedValue(relayHistory({ relays: [] })),
      getHealth: vi.fn().mockResolvedValue(health()),
    };
    render(Network, { props: { api: api as unknown as ConsoleApi, pageRelays: ['ws://127.0.0.1:7777'], networkView: 'relays' } });
    await fireEvent.input(await screen.findByLabelText('Add relay'), { target: { value: 'wss://new.example' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await save();
    expect(ask).toHaveBeenCalled();
    expect(api.updateNetwork).not.toHaveBeenCalled();
  });

  it('tests a saved proxy by its id, and refuses group intervals the service would refuse', async () => {
    const list = [
      { id: 'a', name: '', url: 'socks5://h:1' },
      { id: 'b', name: '', url: 'socks5://h:2' },
    ];
    const groups = [{ id: 'g', name: 'Exits', proxies: ['a', 'b'], strategy: 'round_robin' as const, rotate_secs: 10, chaos_min_secs: 300, chaos_max_secs: 900 }];
    const t = setup(networkView({ settings: settings({ proxies: { ...settings().proxies, list, groups } }) }));
    await fireEvent.click(await screen.findByRole('tab', { name: /^Proxies/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Test proxy 1' }));
    await waitFor(() => expect(t.checkProxy).toHaveBeenCalledWith({ id: 'a' }));
    expect(screen.getByText('Group Exits: intervals run from 1 minute to 7 days.')).toBeTruthy();
    await save();
    expect(t.updateNetwork).not.toHaveBeenCalled();
  });
});
