import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { nip19 } from 'nostr-tools';
import App from './App.svelte';
import { ApiError, type ConsoleApi, type Session } from '../lib/api';
import { ADMIN_PUBKEY, PUBKEY, health, info, networkView, relayHistory } from '../test-helpers';

const RELAY = 'ws://127.0.0.1:7777';
const NSEC = nip19.nsecEncode(new Uint8Array(32).fill(1));

function session(): Session {
  return {
    api: {
      getNetwork: vi.fn().mockResolvedValue(networkView()),
      getHealth: vi.fn().mockResolvedValue(health()),
      getRelayHistory: vi.fn().mockResolvedValue(relayHistory()),
    } as unknown as ConsoleApi,
    pubkey: PUBKEY,
    info: info({ name: 'shop' }),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function memory(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } as Storage;
}

function setup(connect: ReturnType<typeof vi.fn>, storage = memory(), extension: () => unknown = () => ({ getPublicKey: vi.fn(), signEvent: vi.fn(), nip44: { encrypt: vi.fn(), decrypt: vi.fn() } })) {
  render(App, { props: { connect, extension, storage } as never });
  return storage;
}

async function fill(pubkey = ADMIN_PUBKEY, relays = RELAY) {
  await fireEvent.input(screen.getByLabelText('Administration key'), { target: { value: pubkey } });
  await fireEvent.input(screen.getByLabelText('Relays'), { target: { value: relays } });
}

async function signInWithSecret() {
  await fireEvent.input(screen.getByLabelText('Secret key'), { target: { value: NSEC } });
  await fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('App', () => {
  it('signs in with a secret key, remembers the service, shows the network and signs out', async () => {
    const s = session();
    const connect = vi.fn().mockResolvedValue(s);
    const storage = setup(connect);
    await fill();
    await signInWithSecret();
    expect(await screen.findByText('How the service is reached')).toBeTruthy();
    expect(connect).toHaveBeenCalledWith(expect.anything(), { serverPubkey: ADMIN_PUBKEY, relays: [RELAY] });
    expect(screen.getByText('console · shop')).toBeTruthy();
    expect(screen.getByText('regtest')).toBeTruthy();
    expect(JSON.parse(storage.getItem('deadhop-console:target')!)).toEqual({ pubkey: ADMIN_PUBKEY, relays: RELAY });

    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(s.close).toHaveBeenCalled();
    // Back on the sign-in page, with the service filled in.
    expect((screen.getByLabelText('Administration key') as HTMLInputElement).value).toBe(ADMIN_PUBKEY);
  });

  it('opens with the service used last, and signs in through the browser extension', async () => {
    const storage = memory();
    storage.setItem('deadhop-console:target', JSON.stringify({ pubkey: ADMIN_PUBKEY, relays: RELAY }));
    const connect = vi.fn().mockResolvedValue(session());
    setup(connect, storage);
    expect((screen.getByLabelText('Relays') as HTMLTextAreaElement).value).toBe(RELAY);
    await fireEvent.click(screen.getByRole('button', { name: 'Use browser extension' }));
    expect(await screen.findByText('How the service is reached')).toBeTruthy();
  });

  it('says what is wrong with the service typed, without connecting', async () => {
    const connect = vi.fn();
    setup(connect);
    await fill('npub1nope');
    await signInWithSecret();
    expect(screen.getByRole('alert').textContent).toContain('administration key');
    expect(connect).not.toHaveBeenCalled();
  });

  it('explains a key that is not an operator, and any other failure', async () => {
    const connect = vi.fn().mockRejectedValueOnce(new ApiError('unauthorized')).mockRejectedValueOnce(new Error('No relay answered.'));
    setup(connect);
    await fill();
    await signInWithSecret();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This key is not an operator of this service.'));
    await signInWithSecret();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('No relay answered.'));
  });

  it('reports a missing browser extension', async () => {
    setup(vi.fn(), memory(), () => undefined);
    await fill();
    await fireEvent.click(screen.getByRole('button', { name: 'Use browser extension' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('No Nostr extension found in this browser'));
  });

  it('looks for the extension in the page by default', async () => {
    render(App, { props: { connect: vi.fn(), storage: memory() } as never });
    await fill();
    await fireEvent.click(screen.getByRole('button', { name: 'Use browser extension' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('No Nostr extension found in this browser'));
  });

  it('signs out even when closing the connection fails', async () => {
    const s = session();
    (s.close as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('gone'));
    setup(vi.fn().mockResolvedValue(s));
    await fill();
    await signInWithSecret();
    await screen.findByText('How the service is reached');
    await fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Administration key')).toBeTruthy();
  });
});
