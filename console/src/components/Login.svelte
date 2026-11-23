<script lang="ts">
  // Sign in to a service's administration key: which service (its key and
  // relays), then who (a browser extension or a secret key kept in memory).
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import type { TargetInput } from '../lib/config';

  export type SignInKind = 'extension' | 'secret';

  let {
    target = $bindable(),
    onSignIn,
    busy = false,
    error = '',
  }: { target: TargetInput; onSignIn: (kind: SignInKind, secret?: string) => void; busy?: boolean; error?: string } = $props();

  let secret = $state('');

  function submitSecret(event: SubmitEvent) {
    event.preventDefault();
    onSignIn('secret', secret);
    secret = '';
  }
</script>

<section class="login" aria-labelledby="login-title">
  <svg class="login-mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false"
    ><circle cx="4.6" cy="20" r="3.1" fill="currentColor" /><path
      d="M7.4 16.2C10.5 5 20 2.6 24.5 14.8"
      fill="none"
      stroke="currentColor"
      stroke-width="2.8"
      stroke-linecap="round"
      stroke-dasharray="4.2 3.6"
    /><path
      d="M18 18.5H22.3V20.2a1 1 0 0 0 1 1H25.7a1 1 0 0 0 1-1V18.5H31V28.5a1.5 1.5 0 0 1-1.5 1.5H19.5A1.5 1.5 0 0 1 18 28.5Z"
      fill="currentColor"
    /></svg
  >
  <h1 id="login-title">deadhop console</h1>
  <p class="muted">Manage the relays and proxies of a deadhop service.</p>

  <div class="target">
    <label for="pubkey">Administration key</label>
    <input
      id="pubkey"
      class="mono"
      autocomplete="off"
      spellcheck="false"
      placeholder="npub1…, nprofile1… or hex"
      bind:value={target.pubkey}
    />
    <label for="relays">Relays</label>
    <textarea
      id="relays"
      class="mono"
      rows="2"
      spellcheck="false"
      placeholder="wss://relay.example.com (one per line; an nprofile brings its own)"
      bind:value={target.relays}
    ></textarea>
  </div>

  <button class="primary wide" disabled={busy} onclick={() => onSignIn('extension')}>Use browser extension</button>

  <p class="or" aria-hidden="true"><span>or</span></p>

  <form class="secret-form" onsubmit={submitSecret}>
    <label class="visually-hidden" for="secret">Secret key</label>
    <input
      id="secret"
      class="mono"
      type="password"
      autocomplete="off"
      spellcheck="false"
      placeholder="nsec1… kept in memory only"
      bind:value={secret}
    />
    <button type="submit" disabled={busy || secret.trim() === ''}>Sign in</button>
  </form>

  {#if busy}<Loading label="Signing in" />{/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
