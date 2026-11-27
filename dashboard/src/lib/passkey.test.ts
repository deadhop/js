import { describe, expect, it, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import { hexToBytes } from '@noble/hashes/utils.js';
import { PRF_SALT, createPasskey, secretFromPrf, support, usePasskey } from './passkey';

const PRF = new Uint8Array(32).fill(7);
const ID = new Uint8Array([1, 2, 3]).buffer;

/** A credential as the browser returns it, with these PRF extension results. */
const credential = (prf: unknown) => ({ rawId: ID, getClientExtensionResults: () => (prf === undefined ? {} : { prf }) });

function creds(created: unknown, got: unknown = credential({ results: { first: PRF.buffer } })) {
  return { create: vi.fn(async () => created), get: vi.fn(async () => got) } as unknown as CredentialsContainer & {
    create: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };
}

describe('passkey keys', () => {
  it('are made from the PRF output, the same each time', () => {
    const secret = secretFromPrf(PRF);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(secretFromPrf(PRF)).toBe(secret);
    expect(secretFromPrf(new Uint8Array(32).fill(8))).not.toBe(secret);
    // The salt is fixed: changing it would change every operator's key.
    expect(Buffer.from(PRF_SALT).toString('hex')).toBe('91a24472d73bb8adbf1d3155e77715aa0883a4040dd2823133a0d47c3c8a1685');
  });

  it('come from a new passkey that evaluates PRF when made', async () => {
    const c = creds(credential({ enabled: true, results: { first: PRF } }));
    const key = await createPasskey('Laptop', c);
    expect(key.secret).toBe(secretFromPrf(PRF));
    expect(key.pubkey).toBe(getPublicKey(hexToBytes(key.secret)));
    expect(key.id).toEqual(new Uint8Array([1, 2, 3]));
    const opts = c.create.mock.calls[0][0].publicKey;
    expect(opts.user.name).toBe('Laptop');
    expect(opts.authenticatorSelection.userVerification).toBe('required');
    expect(opts.extensions.prf.eval.first).toBe(PRF_SALT);
    expect(c.get).not.toHaveBeenCalled();
  });

  it('use the new passkey once when PRF is only evaluated on use', async () => {
    const c = creds(credential({ enabled: true }));
    const key = await createPasskey('Laptop', c);
    expect(key.secret).toBe(secretFromPrf(PRF));
    expect(c.get.mock.calls[0][0].publicKey.allowCredentials[0].id).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('are refused from a password manager without PRF', async () => {
    await expect(createPasskey('x', creds(credential({ enabled: false })))).rejects.toThrow('PRF extension');
    await expect(createPasskey('x', creds(credential(undefined)))).rejects.toThrow('PRF extension');
    await expect(createPasskey('x', creds(null))).rejects.toThrow('No passkey was made.');
  });

  it('sign in with any passkey of this site, or a given one', async () => {
    const c = creds(null);
    expect((await usePasskey(undefined, c)).secret).toBe(secretFromPrf(PRF));
    expect(c.get.mock.calls[0][0].publicKey.allowCredentials).toEqual([]);
    await expect(usePasskey(undefined, creds(null, null))).rejects.toThrow('No passkey was chosen.');
    await expect(usePasskey(undefined, creds(null, credential({})))).rejects.toThrow('PRF extension');
  });
});

describe('passkey support', () => {
  const win = (pkc: unknown, secure = true, credentials: unknown = {}) =>
    ({ PublicKeyCredential: pkc, isSecureContext: secure, navigator: { credentials } }) as unknown as Window;

  it('follows what the browser says', async () => {
    const caps = (c: unknown) => ({ getClientCapabilities: async () => c });
    expect(await support(win(caps({ 'extension:prf': true })))).toBe('yes');
    expect(await support(win(caps({ 'extension:prf': false })))).toBe('no');
    expect(await support(win(caps({})))).toBe('maybe');
    expect(await support(win({ getClientCapabilities: async () => Promise.reject(new Error('x')) }))).toBe('maybe');
    expect(await support(win({}))).toBe('maybe');
  });

  it('is none without WebAuthn or a secure page', async () => {
    expect(await support(win(undefined))).toBe('no');
    expect(await support(win({}, false))).toBe('no');
    expect(await support(win({}, true, null))).toBe('no');
    // jsdom has no WebAuthn at all.
    expect(await support()).toBe('no');
  });
});
