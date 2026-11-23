import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from './config';
import { ADMIN_PUBKEY, PUBKEY } from '../test-helpers';

function fetcher(response: Partial<Response> | Error) {
  return vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response as Response;
  }) as unknown as typeof fetch;
}

describe('loadConfig', () => {
  const good = { serverPubkey: PUBKEY, adminPubkey: ADMIN_PUBKEY, relays: ['wss://relay.example'] };

  it('fetches and validates config.json without caching', async () => {
    const f = fetcher({ ok: true, json: async () => good });
    expect(await loadConfig(f)).toEqual(good);
    expect(f).toHaveBeenCalledWith('config.json', { cache: 'no-store' });
  });

  it('explains a missing or unreadable file', async () => {
    await expect(loadConfig(fetcher({ ok: false, status: 404 }))).rejects.toThrow('missing or unreadable');
    await expect(loadConfig(fetcher(new Error('offline')))).rejects.toThrow('missing or unreadable');
    const notJson = fetcher({ ok: true, json: async () => Promise.reject(new SyntaxError('bad')) });
    await expect(loadConfig(notJson)).rejects.toThrow('missing or unreadable');
  });

  it('explains an invalid file', async () => {
    const f = fetcher({ ok: true, json: async () => ({ serverPubkey: 'x', relays: [] }) });
    await expect(loadConfig(f)).rejects.toThrow('config.json is invalid');
    // A config from before there were two keys has no administration key.
    const old = fetcher({ ok: true, json: async () => ({ serverPubkey: PUBKEY, relays: ['wss://relay.example'] }) });
    await expect(loadConfig(old)).rejects.toThrow('deadhop pubkey admin');
  });

  it('uses the global fetch by default', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => good } as Response);
    expect(await loadConfig()).toEqual(good);
    expect(spy).toHaveBeenCalledWith('config.json', { cache: 'no-store' });
    expect(spy).toHaveBeenCalledWith('relays.json', { cache: 'no-store' });
  });
});

describe('the service\'s live relays', () => {
  const good = { serverPubkey: PUBKEY, adminPubkey: ADMIN_PUBKEY, relays: ['wss://relay.example', 'wss://shared.example'] };
  // config.json, then relays.json.
  const files = (live: Partial<Response> | Error) =>
    vi.fn(async (url: string) => {
      if (url === 'config.json') return { ok: true, json: async () => good } as Response;
      if (live instanceof Error) throw live;
      return live as Response;
    }) as unknown as typeof fetch;

  it('come first, then the configured ones, each once', async () => {
    const live = { invoices: ['wss://saved.example', 'wss://shared.example'], admin: ['wss://admin.example'] };
    const f = files({ ok: true, json: async () => live });
    expect(await loadConfig(f)).toEqual({
      ...good,
      relays: ['wss://saved.example', 'wss://shared.example', 'wss://relay.example'],
      adminRelays: ['wss://admin.example', 'wss://relay.example', 'wss://shared.example'],
    });
    expect(f).toHaveBeenCalledWith('relays.json', { cache: 'no-store' });
  });

  it('are added to configured administration relays too', async () => {
    const withAdmin = { ...good, adminRelays: ['wss://own-admin.example'] };
    const f = vi.fn(async (url: string) =>
      url === 'config.json'
        ? ({ ok: true, json: async () => withAdmin } as Response)
        : ({ ok: true, json: async () => ({ invoices: [], admin: [] }) } as Response),
    ) as unknown as typeof fetch;
    expect(await loadConfig(f)).toEqual(withAdmin);
  });

  it('leave config.json alone when relays.json is missing, unreadable or wrong', async () => {
    for (const live of [
      { ok: false, status: 404 },
      new Error('offline'),
      { ok: true, json: async () => Promise.reject(new SyntaxError('an index.html')) },
      { ok: true, json: async () => ({ invoices: ['ws://plain.example'], admin: [] }) },
    ]) {
      expect(await loadConfig(files(live))).toEqual(good);
    }
  });
});
