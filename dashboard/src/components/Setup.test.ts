import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import Setup from './Setup.svelte';
import type { SetupStatus } from '../lib/setup';
import { ADMIN_PUBKEY, PUBKEY, STATUS, TPUB, ZPUB } from '../test-helpers';

const FP = 'ab'.repeat(32);
const short = (hex: string) => {
  const n = nip19.npubEncode(hex);
  return `${n.slice(0, 8)}…${n.slice(-6)}`;
};

function passkeys(over: Record<string, unknown> = {}) {
  return {
    support: vi.fn().mockResolvedValue('yes'),
    createPasskey: vi.fn().mockResolvedValue({ secret: '11'.repeat(32), pubkey: ADMIN_PUBKEY, id: new Uint8Array([9]) }),
    usePasskey: vi.fn().mockResolvedValue({ secret: '11'.repeat(32), pubkey: ADMIN_PUBKEY, id: new Uint8Array([9]) }),
    ...over,
  };
}

function show(props: Record<string, unknown> = {}) {
  const copy = vi.fn().mockResolvedValue(undefined);
  const download = vi.fn();
  const passkey = passkeys();
  const view = render(Setup, {
    props: { status: STATUS, defaultRelays: ['wss://relay.example'], passkey, copy, download, host: 'pay.example.com', ...props } as never,
  });
  return { copy, download, passkey, ...view };
}

const next = () => fireEvent.click(screen.getByRole('button', { name: /^(Continue|Review|Start setup)$/ }));
const back = () => fireEvent.click(screen.getByRole('button', { name: 'Back' }));
const type = (label: string | RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } });
const block = () => screen.getByTestId('settings-block').textContent;

beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

describe('Setup', () => {
  it('says what the service reported and starts the steps', async () => {
    show();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('This deadhop is waiting for its settings.');
    expect(screen.getByText('DEADHOP_ELECTRUM')).toBeTruthy();
    expect(screen.getAllByText('missing')).toHaveLength(2);
    expect(screen.getAllByText('found')).toHaveLength(2);
    expect(screen.getByText('default').className).toContain('state default');
    expect(screen.queryByRole('list', { name: 'Steps' })).toBeNull();
    await next();
    const steps = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(steps[0].classList.contains('now')).toBe(true);
    expect(steps[0].getAttribute('aria-current')).toBe('step');
    expect(steps[1].classList.contains('now') || steps[1].classList.contains('done')).toBe(false);
    await next();
    expect(within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem')[0].classList.contains('done')).toBe(true);
    await back();
    await back();
    expect(screen.getByRole('button', { name: 'Start setup' })).toBeTruthy();
  });

  it('keeps the wallet service’s key, or checks the operator’s own', async () => {
    show();
    await next();
    expect(screen.getByRole('heading', { name: 'Network and wallet' })).toBeTruthy();
    const service = screen.getByRole('radio', { name: /Keep the wallet/ }) as HTMLInputElement;
    expect(service.checked).toBe(true);
    expect(screen.getByText(/· found/)).toBeTruthy();
    expect(screen.getByText(/DEADHOP_NETWORK=bitcoin/)).toBeTruthy();
    const cont = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(cont.disabled).toBe(false);

    await fireEvent.click(screen.getByRole('radio', { name: /Use my own/ }));
    expect(cont.disabled).toBe(true);
    await type('Account key', TPUB);
    expect(screen.getByRole('alert').textContent).toBe('This key is for a test network.');
    expect(cont.disabled).toBe(true);
    expect(screen.queryByText('Check before going live')).toBeNull();
    await type('Account key', ZPUB);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(cont.disabled).toBe(false);
    expect(screen.getByText('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBeTruthy();
    expect(screen.getByText(new RegExp(`DEADHOP_XPUB=${ZPUB}`))).toBeTruthy();

    await fireEvent.click(screen.getByRole('radio', { name: 'Regtest' }));
    expect(screen.getByRole('alert').textContent).toBe('This key is for mainnet.');
    await fireEvent.click(screen.getByRole('radio', { name: /Keep the wallet/ }));
    expect(cont.disabled).toBe(false);
    expect(screen.queryByLabelText('Account key')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Regtest' }).closest('label')!.classList.contains('on')).toBe(true);
    expect(screen.getByRole('radio', { name: 'Signet' }).closest('label')!.classList.contains('on')).toBe(false);
  });

  it('asks for the own key when the wallet service made none', async () => {
    const status: SetupStatus = { ...STATUS, network: 'regtest', settings: STATUS.settings.map((s) => (s.name === 'DEADHOP_XPUB' ? { ...s, state: 'missing' } : s)) };
    show({ status, defaultRelays: undefined });
    await next();
    expect((screen.getByRole('radio', { name: /Keep the wallet/ }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Use my own/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/The service found none/)).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Regtest' }) as HTMLInputElement).checked).toBe(true);
  });

  it('checks the Electrum server and pins its certificate', async () => {
    show();
    await next();
    await next();
    expect(screen.getByRole('heading', { name: 'Chain backend' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/DEADHOP_ELECTRUM=/)).toBeTruthy();
    await type('Electrum server', 'node');
    expect(screen.getByRole('alert').textContent).toBe('Use host:port, or tls://host:port.');
    await type('Electrum server', 'node.lan:50001');
    expect(screen.getByText(/Plain TCP to another machine/)).toBeTruthy();
    await type('Electrum server', '127.0.0.1:50001');
    expect(screen.queryByText(/Plain TCP to another machine/)).toBeNull();
    expect(screen.queryByLabelText('SHA-256 fingerprint')).toBeNull();
    await type('Electrum server', 'tls://fulcrum.lan:50002');
    expect(screen.getByText('docker compose run --rm deadhop fingerprint fulcrum.lan:50002')).toBeTruthy();
    await type('SHA-256 fingerprint', 'abc');
    expect(screen.getByText('The fingerprint is 64 hex characters.')).toBeTruthy();
    await type('SHA-256 fingerprint', FP);
    expect(screen.queryByText('The fingerprint is 64 hex characters.')).toBeNull();
    expect(screen.getByText(new RegExp(`DEADHOP_ELECTRUM_CERT_SHA256=${FP}`))).toBeTruthy();
  });

  it('adds operators by pasting, from an extension and from a passkey', async () => {
    const getPublicKey = vi.fn().mockResolvedValueOnce(PUBKEY).mockResolvedValueOnce('nope').mockRejectedValueOnce(new Error('User rejected'));
    const t = show({ extension: () => ({ getPublicKey }) });
    await next();
    await next();
    await next();
    expect(screen.getByRole('heading', { name: 'Operators' })).toBeTruthy();
    expect(screen.getByText('None yet.')).toBeTruthy();
    expect(screen.getByText('pay.example.com')).toBeTruthy();

    await type('hex, npub or nprofile', 'nope');
    await fireEvent.submit(screen.getByLabelText('hex, npub or nprofile').closest('form')!);
    expect(screen.getByRole('alert').textContent).toBe('The key must be hex, npub or nprofile.');
    await type('hex, npub or nprofile', nip19.npubEncode(PUBKEY));
    await fireEvent.submit(screen.getByLabelText('hex, npub or nprofile').closest('form')!);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('Added (1)')).toBeTruthy();
    expect((screen.getByLabelText('hex, npub or nprofile') as HTMLInputElement).value).toBe('');

    await fireEvent.click(screen.getByRole('button', { name: 'Browser extension' }));
    await waitFor(() => expect(getPublicKey).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Added (1)')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Browser extension' }));
    expect(await screen.findByText('The extension did not give a public key.')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Browser extension' }));
    expect(await screen.findByText('User rejected')).toBeTruthy();

    await type('Name in your password manager', '  ');
    await fireEvent.click(screen.getByRole('button', { name: 'Create passkey' }));
    await screen.findByText('Added (2)');
    expect(t.passkey.createPasskey).toHaveBeenCalledWith('deadhop operator');
    expect(screen.getByText('Passkey')).toBeTruthy();
    expect(screen.getByText(new RegExp(`DEADHOP_ADMINS=${PUBKEY},${ADMIN_PUBKEY}`))).toBeTruthy();
    expect(screen.queryByText(/A lost passkey is a lost operator/)).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Test sign-in' }));
    expect(await screen.findByText('Sign-in works.')).toBeTruthy();
    expect(t.passkey.usePasskey).toHaveBeenCalledWith(new Uint8Array([9]));
    t.passkey.usePasskey.mockResolvedValueOnce({ secret: '', pubkey: PUBKEY, id: new Uint8Array() });
    await fireEvent.click(screen.getByRole('button', { name: 'Test sign-in' }));
    expect(await screen.findByText('That passkey gives another key.')).toBeTruthy();
    t.passkey.usePasskey.mockRejectedValueOnce(new Error('No passkey was chosen.'));
    await fireEvent.click(screen.getByRole('button', { name: 'Test sign-in' }));
    expect(await screen.findByText('No passkey was chosen.')).toBeTruthy();

    // With a passkey as the only operator, ask for a second one.
    await fireEvent.click(screen.getByRole('button', { name: `Remove ${short(PUBKEY)}` }));
    expect(screen.getByText(/A lost passkey is a lost operator/)).toBeTruthy();
  });

  it('names the passkey, reports failures, and says when passkeys are not available', async () => {
    const t = show({ extension: () => undefined });
    t.passkey.createPasskey.mockRejectedValueOnce(new Error('cannot make a nostr key'));
    await next();
    await next();
    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Browser extension' }));
    expect(screen.getByRole('alert').textContent).toBe('No Nostr extension found in this browser.');
    await fireEvent.click(await screen.findByRole('button', { name: 'Create passkey' }));
    expect(await screen.findByText('cannot make a nostr key')).toBeTruthy();
    await type('Name in your password manager', 'Laptop');
    await fireEvent.click(screen.getByRole('button', { name: 'Create passkey' }));
    expect(await screen.findByText('· Laptop')).toBeTruthy();
    expect(t.passkey.createPasskey).toHaveBeenLastCalledWith('Laptop');
    t.unmount();

    show({ passkey: passkeys({ support: vi.fn().mockResolvedValue('no') }) });
    await next();
    await next();
    await next();
    expect(screen.getByText(/Not available in this browser/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create passkey' })).toBeNull();
  });

  it('sets public invoicing, relays, name and proxy', async () => {
    show();
    for (let i = 0; i < 4; i++) await next();
    expect(screen.getByRole('heading', { name: 'Access and relays' })).toBeTruthy();
    expect(screen.queryByLabelText('Work per request')).toBeNull();
    await fireEvent.click(screen.getByRole('checkbox', { name: /Let anyone create invoices/ }));
    await fireEvent.change(screen.getByLabelText('Work per request'), { target: { value: '24' } });
    expect(screen.getByText(/DEADHOP_POW_BITS=24/)).toBeTruthy();
    await fireEvent.change(screen.getByLabelText('Work per request'), { target: { value: '20' } });
    expect(screen.queryByText(/DEADHOP_POW_BITS/)).toBeNull();
    await fireEvent.change(screen.getByLabelText('Work per request'), { target: { value: '16' } });

    await type('Add a relay', 'https://nope');
    await fireEvent.submit(screen.getByLabelText('Add a relay').closest('form')!);
    expect(screen.getByRole('alert').textContent).toBe('A relay is a ws:// or wss:// url.');
    await type('Add a relay', 'wss://two.example');
    await fireEvent.submit(screen.getByLabelText('Add a relay').closest('form')!);
    await type('Add a relay', 'wss://two.example');
    await fireEvent.submit(screen.getByLabelText('Add a relay').closest('form')!);
    expect(screen.getAllByRole('button', { name: /^Remove wss:/ })).toHaveLength(2);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove wss://relay.example' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Remove wss://two.example' }));
    expect(screen.getByText('Add a relay.')).toBeTruthy();
    await type('Add a relay', 'wss://three.example');
    await fireEvent.submit(screen.getByLabelText('Add a relay').closest('form')!);

    await type('Service name', 'Corner shop');
    await type('SOCKS proxy for relays (Tor)', 'tor');
    expect(screen.getByText('The proxy is socks5://host:port.')).toBeTruthy();
    await type('SOCKS proxy for relays (Tor)', 'socks5h://127.0.0.1:9050');
    expect(screen.getByText(/DEADHOP_PROXY=socks5h/)).toBeTruthy();
    expect(screen.getByText(/DEADHOP_POW_BITS=16/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review' })).toBeTruthy();
  });

  it('lists what is missing before it gives the settings', async () => {
    show();
    for (let i = 0; i < 5; i++) await next();
    expect(screen.getByRole('heading', { name: 'Your settings' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^(Continue|Review)$/ })).toBeNull();
    expect(screen.getByText(/Enter the Electrum server/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Chain backend' }));
    expect(screen.getByRole('heading', { name: 'Chain backend' })).toBeTruthy();
  });

  it('ends with the settings in each format, to copy or download', async () => {
    const t = show();
    await next();
    await next();
    await type('Electrum server', 'tls://fulcrum.lan:50002');
    await next();
    await type('hex, npub or nprofile', PUBKEY);
    await fireEvent.submit(screen.getByLabelText('hex, npub or nprofile').closest('form')!);
    await next();
    await next();
    expect(block()).toBe(
      `# deadhop settings, made by the setup page\nDEADHOP_NETWORK=bitcoin\nDEADHOP_ELECTRUM=tls://fulcrum.lan:50002\nDEADHOP_ADMINS=${PUBKEY}\nDEADHOP_RELAYS=wss://relay.example\n`,
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(t.copy).toHaveBeenCalledWith(block());
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('tab', { name: 'Kubernetes' }));
    expect(screen.getByRole('tab', { name: 'Kubernetes' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
    expect(block()).toContain('kind: Secret');
    expect(screen.getByText(/kubectl apply/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Download deadhop-settings.yaml' }));
    expect(t.download).toHaveBeenCalledWith('deadhop-settings.yaml', block());
  });

  it('copies with the clipboard and downloads with a link by default', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    (window as unknown as { nostr: unknown }).nostr = { getPublicKey: vi.fn().mockResolvedValue(PUBKEY) };
    render(Setup, { props: { status: STATUS, defaultRelays: ['wss://r.example'] } as never });
    await next();
    await next();
    await type('Electrum server', '127.0.0.1:50001');
    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Browser extension' }));
    await screen.findByText('Added (1)');
    // jsdom has no WebAuthn: the real check says no.
    expect(await screen.findByText(/Not available in this browser/)).toBeTruthy();
    await next();
    await next();
    await fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(block());
    await fireEvent.click(screen.getByRole('button', { name: 'Download .env' }));
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');
    delete (window as unknown as { nostr?: unknown }).nostr;
  });
});
