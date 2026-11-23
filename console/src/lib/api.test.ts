import { describe, expect, it, vi } from 'vitest';
import { ApiError, ConsoleApi, LOOKUP_TIMEOUT_MS, connect } from './api';
import { health, i2pLookup, info, networkView, privacyAudit, proxyCheck, relayHistory } from '../test-helpers';

const answer = (structuredContent: unknown) => vi.fn().mockResolvedValue({ structuredContent });

describe('ConsoleApi', () => {
  it('reads and changes the network settings with get_network and update_network', async () => {
    const v = networkView();
    const call = answer(v);
    const api = new ConsoleApi(call);
    expect(await api.getNetwork()).toEqual(v);
    expect(call).toHaveBeenLastCalledWith('get_network', {});
    await api.updateNetwork({ relay_names: { 'ws://127.0.0.1:7777': 'home' } });
    expect(call).toHaveBeenLastCalledWith('update_network', { patch: { relay_names: { 'ws://127.0.0.1:7777': 'home' } } });
  });

  it('refuses a network view with fields it does not know', async () => {
    await expect(new ConsoleApi(answer({ ...networkView(), extra: 1 })).getNetwork()).rejects.toEqual(new ApiError('bad_response'));
  });

  it('keeps only the network part of the health, and checks it', async () => {
    const full = { ...health(), service: { version: '1' }, database: { ok: true } };
    expect(await new ConsoleApi(answer(full)).getHealth()).toEqual(health());
    await expect(new ConsoleApi(answer({ ...health(), proxy_pool: null })).getHealth()).rejects.toEqual(new ApiError('bad_response'));
  });

  it('calls the network tools with their arguments', async () => {
    const proxy = answer(proxyCheck());
    const api = new ConsoleApi(proxy);
    await api.checkProxy();
    expect(proxy).toHaveBeenLastCalledWith('check_proxy', {});
    await api.checkProxy('socks5://127.0.0.1:9050');
    expect(proxy).toHaveBeenLastCalledWith('check_proxy', { proxy: 'socks5://127.0.0.1:9050' });
    await api.checkProxy({ id: 'p1' });
    expect(proxy).toHaveBeenLastCalledWith('check_proxy', { id: 'p1' });

    const lookup = answer(i2pLookup());
    await new ConsoleApi(lookup).resolveI2pName('nostr-not.i2p');
    expect(lookup).toHaveBeenLastCalledWith('resolve_i2p_name', { name: 'nostr-not.i2p' }, LOOKUP_TIMEOUT_MS);

    const relays = answer({ relays: [] });
    await new ConsoleApi(relays).checkRelays();
    expect(relays).toHaveBeenLastCalledWith('check_relays', {});

    const history = answer(relayHistory({ window: '1h' }));
    await new ConsoleApi(history).getRelayHistory();
    expect(history).toHaveBeenLastCalledWith('get_relay_history', { window: '1h' });
    const day = answer(relayHistory());
    await new ConsoleApi(day).getRelayHistory('1d');
    expect(day).toHaveBeenLastCalledWith('get_relay_history', { window: '1d' });

    const audit = answer(privacyAudit());
    expect(await new ConsoleApi(audit).getPrivacyAudit()).toEqual(privacyAudit());
    expect(audit).toHaveBeenLastCalledWith('get_privacy_audit', {});
  });
});

describe('connect', () => {
  const target = { serverPubkey: 'ab'.repeat(32), relays: ['ws://127.0.0.1:7777'] };
  const opened = (isAdmin: boolean) => ({ api: {}, callTool: vi.fn(), pubkey: 'cd'.repeat(32), info: info({ is_admin: isAdmin }), close: vi.fn().mockResolvedValue(undefined) });

  it('signs an operator in to the administration key', async () => {
    const s = opened(true);
    const open = vi.fn().mockResolvedValue(s);
    const signer = {} as never;
    const session = await connect(signer, target, 5000, open);
    expect(open).toHaveBeenCalledWith(signer, target, { timeoutMs: 5000, clientName: 'deadhop-console' });
    expect(session.api).toBeInstanceOf(ConsoleApi);
    expect(session.pubkey).toBe('cd'.repeat(32));
    expect(session.info.is_admin).toBe(true);
    await session.close();
    expect(s.close).toHaveBeenCalled();
  });

  it('closes the connection and refuses a key that is not an operator', async () => {
    const s = opened(false);
    s.close.mockRejectedValue(new Error('already closed'));
    await expect(connect({} as never, target, undefined, vi.fn().mockResolvedValue(s))).rejects.toEqual(new ApiError('unauthorized'));
    expect(s.close).toHaveBeenCalled();
  });
});
