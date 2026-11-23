// What a connection is doing, step by step, for a status display. A call to
// the service is: sign the request (the signer, which may be a browser
// extension that asks first), hand it to the relays (done when the first one
// accepts it), wait for the reply, and decrypt it (the signer again).
import type { NostrSigner, RelayHandler } from '@contextvm/sdk';

/** A step that has a start and an end. */
export type ActivityStep =
  /** The signer is asked for the public key. */
  | 'key'
  /** The signer signs a request (with any proof of work first). */
  | 'sign'
  /** The signer encrypts a request. */
  | 'encrypt'
  /** The signer decrypts a reply. */
  | 'decrypt'
  /** A request is out to the relays and none has accepted it yet. */
  | 'publish';

/** One thing that happened on a connection. */
export type ActivityEvent =
  | { type: 'start'; step: ActivityStep; id: number }
  /** `ok` is false when the step failed (the error itself goes to the caller). */
  | { type: 'end'; step: ActivityStep; id: number; ok: boolean }
  /** An event for this connection arrived from a relay (normally a reply). */
  | { type: 'receive' };

export type ActivityListener = (event: ActivityEvent) => void;

/** Runs `work` as one step, reporting its start and end. */
function step<T>(emit: ActivityListener, next: () => number, name: ActivityStep, work: () => Promise<T>): Promise<T> {
  const id = next();
  emit({ type: 'start', step: name, id });
  return work().then(
    (value) => {
      emit({ type: 'end', step: name, id, ok: true });
      return value;
    },
    (error: unknown) => {
      emit({ type: 'end', step: name, id, ok: false });
      throw error;
    },
  );
}

/** A counter shared by the signer and the relays of one connection, so step ids never collide. */
export function stepCounter(): () => number {
  let n = 0;
  return () => ++n;
}

/** `signer`, reporting each request to it as a step. */
export function observedSigner(signer: NostrSigner, emit: ActivityListener, next: () => number): NostrSigner {
  const nip44 = signer.nip44;
  return {
    getPublicKey: () => step(emit, next, 'key', () => signer.getPublicKey()),
    signEvent: (event) => step(emit, next, 'sign', () => signer.signEvent(event)),
    nip44: nip44 && {
      encrypt: (pubkey, plaintext) => step(emit, next, 'encrypt', () => nip44.encrypt(pubkey, plaintext)),
      decrypt: (pubkey, ciphertext) => step(emit, next, 'decrypt', () => nip44.decrypt(pubkey, ciphertext)),
    },
  };
}

/**
 * `relays`, reporting each publish (until the first relay accepts it) and each
 * event received as activity.
 */
export function observedRelays(relays: RelayHandler, emit: ActivityListener, next: () => number): RelayHandler {
  return {
    connect: () => relays.connect(),
    disconnect: (urls) => relays.disconnect(urls),
    publish: (event, opts) => step(emit, next, 'publish', () => relays.publish(event, opts)),
    subscribe: (filters, onEvent, onEose) =>
      relays.subscribe(
        filters,
        (event) => {
          emit({ type: 'receive' });
          onEvent(event);
        },
        onEose,
      ),
    unsubscribe: () => relays.unsubscribe(),
    getRelayUrls: () => relays.getRelayUrls(),
  };
}
