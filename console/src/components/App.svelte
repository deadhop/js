<script lang="ts">
  // The console: choose a service and sign in to its administration key, then
  // edit its network settings.
  import { localSigner, nip07Signer, type Nip07, type NostrSigner, type ServiceConfig } from '@deadhop/client';
  import { nip19 } from 'nostr-tools';
  import { shortKey } from '@deadhop/network-ui/lib/format';
  import { ApiError, connect as defaultConnect, type Session } from '../lib/api';
  import { loadTarget, parseTarget, saveTarget, type TargetInput } from '../lib/config';
  import Login, { type SignInKind } from './Login.svelte';
  import Network from './Network.svelte';

  let {
    connect = defaultConnect,
    extension = () => (window as unknown as { nostr?: Nip07 }).nostr,
    storage = localStorage,
  }: {
    connect?: (signer: NostrSigner, target: ServiceConfig) => Promise<Session>;
    extension?: () => Nip07 | undefined;
    storage?: Storage;
  } = $props();

  // svelte-ignore state_referenced_locally
  let target = $state<TargetInput>(loadTarget(storage));
  /** The relays this page connects through, once signed in. */
  let pageRelays = $state<string[]>([]);
  let session = $state<Session | null>(null);
  let busy = $state(false);
  let error = $state('');

  async function signIn(kind: SignInKind, secret?: string) {
    const t = parseTarget(target);
    if (typeof t === 'string') {
      error = t;
      return;
    }
    busy = true;
    error = '';
    try {
      const signer = kind === 'extension' ? nip07Signer(extension()) : localSigner(secret);
      session = await connect(signer, t);
      pageRelays = t.relays;
      saveTarget(target, storage);
    } catch (e) {
      // The administration key answers operators only.
      error = e instanceof ApiError && e.code === 'unauthorized' ? 'This key is not an operator of this service.' : (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function signOut() {
    const old = session;
    session = null;
    await old?.close().catch(() => undefined);
  }
</script>

{#if session}
  <header class="site">
    <div class="bar">
      <span class="brand"
        ><span class="wordmark">deadhop</span><span class="shop">{`console · ${session.info.name}`}</span></span
      >
      <span class="badge net">{session.info.network}</span>
      <span class="muted mono" title={session.pubkey}>{shortKey(nip19.npubEncode(session.pubkey))}</span>
      <button class="link" onclick={signOut}>Sign out</button>
    </div>
  </header>
  <main class="page">
    <Network api={session.api} {pageRelays} />
  </main>
{:else}
  <main>
    <Login bind:target onSignIn={signIn} {busy} {error} />
  </main>
{/if}
