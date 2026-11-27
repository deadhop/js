// Operator keys from passkeys.
//
// A passkey signs with a P-256 key the page never sees, so it cannot be a
// nostr key itself. What it can do, through the WebAuthn PRF extension, is
// return a secret that is the same every time this passkey is used on this
// site, and differs for every other passkey or site. The nostr secret key is
// derived from that secret, kept in memory only, and is gone with the tab.
// Making the passkey again (or using it on another address) does not give the
// same key: a lost passkey is a lost operator.
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools';

/** What the PRF extension is evaluated on: fixed, so the same passkey always gives the same key. */
export const PRF_SALT = sha256(utf8ToBytes('deadhop operator key v1'));
const INFO = utf8ToBytes('deadhop nostr secret key');

/** Whether this browser can be expected to make keys from passkeys. */
export type Support = 'yes' | 'maybe' | 'no';

type Capabilities = Record<string, boolean>;
interface PkcStatic {
  getClientCapabilities?: () => Promise<Capabilities>;
}

/**
 * `yes` when the browser says it supports PRF, `no` when it says it does not
 * or has no WebAuthn here (plain http other than localhost), `maybe` when it
 * cannot tell (older browsers: whether it works shows when it is tried).
 */
export async function support(win: Window = window): Promise<Support> {
  const pkc = (win as unknown as { PublicKeyCredential?: PkcStatic }).PublicKeyCredential;
  if (!pkc || !win.isSecureContext || !win.navigator.credentials) return 'no';
  if (!pkc.getClientCapabilities) return 'maybe';
  try {
    const caps = await pkc.getClientCapabilities();
    if (caps['extension:prf'] === true) return 'yes';
    return caps['extension:prf'] === false ? 'no' : 'maybe';
  } catch {
    return 'maybe';
  }
}

/** The nostr secret key (hex) made from a PRF output. */
export function secretFromPrf(prf: Uint8Array): string {
  return bytesToHex(hkdf(sha256, prf, PRF_SALT, INFO, 32));
}

/** A passkey's nostr key: its secret (hex, memory only) and public key (hex). */
export interface PasskeyKey {
  secret: string;
  pubkey: string;
  /** The credential's id, to ask for this passkey again. */
  id: Uint8Array;
}

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

interface PrfResult {
  enabled?: boolean;
  results?: { first?: ArrayBuffer | Uint8Array };
}
const prfOf = (cred: PublicKeyCredential): PrfResult | undefined =>
  (cred.getClientExtensionResults() as { prf?: PrfResult }).prf;

function keyFrom(first: ArrayBuffer | Uint8Array, id: ArrayBuffer): PasskeyKey {
  const secret = secretFromPrf(new Uint8Array(first));
  return { secret, pubkey: getPublicKey(hexToBytes(secret)), id: new Uint8Array(id) };
}

const NO_PRF = 'This passkey cannot make a nostr key (its password manager lacks the PRF extension). Try another one, or a browser extension.';

/**
 * Use a passkey made for this site and return its key. With `id`, only that
 * passkey is asked for; without, the browser lets the operator choose one.
 */
export async function usePasskey(id?: Uint8Array, creds: CredentialsContainer = navigator.credentials): Promise<PasskeyKey> {
  const cred = (await creds.get({
    publicKey: {
      challenge: random(32),
      userVerification: 'required',
      allowCredentials: id ? [{ type: 'public-key', id: id as BufferSource }] : [],
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was chosen.');
  const first = prfOf(cred)?.results?.first;
  if (!first) throw new Error(NO_PRF);
  return keyFrom(first, cred.rawId);
}

/**
 * Make a new passkey for this site, named `label` in the password manager,
 * and return its key. Some password managers only evaluate PRF when a
 * passkey is used, not when it is made: then it is used once right away.
 */
export async function createPasskey(label: string, creds: CredentialsContainer = navigator.credentials): Promise<PasskeyKey> {
  const cred = (await creds.create({
    publicKey: {
      challenge: random(32),
      rp: { name: 'deadhop' },
      user: { id: random(16), name: label, displayName: label },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      extensions: { prf: { eval: { first: PRF_SALT } } } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('No passkey was made.');
  const prf = prfOf(cred);
  if (prf?.results?.first) return keyFrom(prf.results.first, cred.rawId);
  if (!prf?.enabled) throw new Error(NO_PRF);
  return usePasskey(new Uint8Array(cred.rawId), creds);
}
