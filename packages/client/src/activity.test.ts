import { describe, expect, it, vi } from 'vitest';
import type { NostrSigner, RelayHandler } from '@contextvm/sdk';

type NostrEvent = Parameters<RelayHandler['publish']>[0];
import { observedRelays, observedSigner, stepCounter, type ActivityEvent } from './activity.ts';

const event = { id: 'e' } as unknown as NostrEvent;

function recorder() {
  const events: ActivityEvent[] = [];
  return { events, emit: (e: ActivityEvent) => events.push(e) };
}

describe('stepCounter', () => {
  it('counts up from one', () => {
    const next = stepCounter();
    expect([next(), next(), next()]).toEqual([1, 2, 3]);
  });
});

describe('observedSigner', () => {
  const inner: NostrSigner = {
    getPublicKey: async () => 'pk',
    signEvent: async () => event,
    nip44: { encrypt: async (_p, t) => `enc:${t}`, decrypt: async (_p, c) => `dec:${c}` },
  };

  it('reports each request to the signer as a step and passes the answers through', async () => {
    const { events, emit } = recorder();
    const s = observedSigner(inner, emit, stepCounter());
    expect(await s.getPublicKey()).toBe('pk');
    expect(await s.signEvent({ kind: 1, content: '', tags: [], created_at: 0 })).toBe(event);
    expect(await s.nip44!.encrypt('p', 'x')).toBe('enc:x');
    expect(await s.nip44!.decrypt('p', 'y')).toBe('dec:y');
    expect(events).toEqual([
      { type: 'start', step: 'key', id: 1 },
      { type: 'end', step: 'key', id: 1, ok: true },
      { type: 'start', step: 'sign', id: 2 },
      { type: 'end', step: 'sign', id: 2, ok: true },
      { type: 'start', step: 'encrypt', id: 3 },
      { type: 'end', step: 'encrypt', id: 3, ok: true },
      { type: 'start', step: 'decrypt', id: 4 },
      { type: 'end', step: 'decrypt', id: 4, ok: true },
    ]);
  });

  it('reports a refusal as a failed step and passes the error on', async () => {
    const { events, emit } = recorder();
    const s = observedSigner({ ...inner, signEvent: async () => Promise.reject(new Error('denied')) }, emit, stepCounter());
    await expect(s.signEvent({ kind: 1, content: '', tags: [], created_at: 0 })).rejects.toThrow('denied');
    expect(events.at(-1)).toEqual({ type: 'end', step: 'sign', id: 1, ok: false });
  });

  it('has no nip44 when the signer has none', () => {
    const { emit } = recorder();
    expect(observedSigner({ getPublicKey: inner.getPublicKey, signEvent: inner.signEvent }, emit, stepCounter()).nip44).toBeUndefined();
  });
});

describe('observedRelays', () => {
  it('reports publishes and received events and passes everything else through', async () => {
    const { events, emit } = recorder();
    let deliver: (e: NostrEvent) => void = () => undefined;
    const inner: RelayHandler = {
      connect: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
      publish: vi.fn(async () => undefined),
      subscribe: vi.fn(async (_f, onEvent) => {
        deliver = onEvent;
        return () => undefined;
      }),
      unsubscribe: vi.fn(),
      getRelayUrls: () => ['wss://r'],
    };
    const r = observedRelays(inner, emit, stepCounter());
    await r.connect();
    await r.disconnect(['wss://r']);
    await r.publish(event);
    const got: NostrEvent[] = [];
    const onEose = () => undefined;
    await r.subscribe([], (e) => got.push(e), onEose);
    deliver(event);
    r.unsubscribe();
    expect(r.getRelayUrls()).toEqual(['wss://r']);
    expect(got).toEqual([event]);
    expect(inner.connect).toHaveBeenCalled();
    expect(inner.disconnect).toHaveBeenCalledWith(['wss://r']);
    expect(inner.publish).toHaveBeenCalledWith(event, undefined);
    expect(vi.mocked(inner.subscribe).mock.calls[0][2]).toBe(onEose);
    expect(inner.unsubscribe).toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'start', step: 'publish', id: 1 },
      { type: 'end', step: 'publish', id: 1, ok: true },
      { type: 'receive' },
    ]);
  });
});
