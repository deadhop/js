<script lang="ts">
  import type { NostrSigner } from '@contextvm/sdk';
  import { ApiError, CONNECT_TIMEOUT_MS, connect as defaultConnect, probeService, type Session } from '../lib/api';
  import { adminTarget, loadConfig as defaultLoadConfig } from '../lib/config';
  import { nip19 } from 'nostr-tools';
  import { shortKey } from '@deadhop/network-ui/lib/format';
  import { parseRoute, payHash, type Route } from '../lib/route';
  import type { Config, Invoice } from '../lib/schemas';
  import { localSigner, nip07Signer, type Nip07 } from '@deadhop/client';
  import Admin from './Admin.svelte';
  import Checkout from './Checkout.svelte';
  import CreateInvoice from './CreateInvoice.svelte';
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import Login, { type ServiceStatus, type SignInKind } from './Login.svelte';
  import StatusBar from './StatusBar.svelte';
  import { activity } from '@deadhop/network-ui/lib/activity.svelte';
  import ServiceKey from './ServiceKey.svelte';
  import Setup from './Setup.svelte';
  import { loadSetup as defaultLoadSetup, type SetupStatus } from '../lib/setup';
  import * as passkeys from '../lib/passkey';

  let {
    loadConfig = defaultLoadConfig,
    // Every call of the signed-in session shows in the status bar.
    connect = (signer, config) => defaultConnect(signer, config, {}, CONNECT_TIMEOUT_MS, activity),
    extension = () => (window as unknown as { nostr?: Nip07 }).nostr,
    probe = probeService,
    loadSetup = defaultLoadSetup,
    passkey = passkeys,
  }: {
    loadConfig?: () => Promise<Config>;
    loadSetup?: () => Promise<SetupStatus | null>;
    passkey?: Pick<typeof passkeys, 'support' | 'usePasskey' | 'createPasskey'>;
    connect?: (signer: NostrSigner, config: Config) => Promise<Session>;
    extension?: () => Nip07 | undefined;
    probe?: (config: Config) => Promise<void>;
  } = $props();

  let serviceStatus = $state<ServiceStatus>('checking');
  // Set while the service waits for its settings (it has never been set up).
  let setup = $state<SetupStatus | null>(null);
  let passkeySignIn = $state(false);

  let config = $state<Config | null>(null);
  let fatal = $state('');
  let session = $state<Session | null>(null);
  let busy = $state(false);
  let error = $state('');
  let route = $state<Route>(parseRoute(location.hash));

  async function signIn(kind: SignInKind, secret?: string) {
    busy = true;
    error = '';
    try {
      if (kind === 'passkey') secret = (await passkey.usePasskey()).secret;
      const signer = kind === 'extension' ? nip07Signer(extension()) : localSigner(kind === 'guest' ? undefined : secret);
      // Operators sign in through the administration key (and its relays); a payment
      // link is for the public, who use the invoices key.
      const target = kind === 'guest' ? config! : adminTarget(config!);
      session = await activity.run(route.name === 'pay' ? 'Opening the invoice' : 'Signing in', () => connect(signer, target));
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
    activity.reset();
    await old?.close().catch(() => undefined);
  }

  // Limits and proof of work can change from the settings page.
  async function refreshInfo() {
    const current = session!;
    try {
      current.info = await current.api.getInfo();
    } catch {
      // Keep the previous values; the next action reports any problem.
    }
  }

  function created(invoice: Invoice) {
    location.hash = payHash(invoice.id);
  }

  // The wordmark already says deadhop; the shop's own name follows it.
  const name = $derived(session?.info.name ?? 'deadhop');
  const shop = $derived(name.toLowerCase().startsWith('deadhop') ? name.slice(7).trim() : name);
  // The operator view runs its tabs under the header and fills the page itself.
  const operator = $derived(session !== null && session.info.is_admin && route.name !== 'pay');

  $effect(() => {
    const onHash = () => (route = parseRoute(location.hash));
    window.addEventListener('hashchange', onHash);
    void loadSetup().then((s) => (setup = s));
    void passkey.support().then((s) => (passkeySignIn = s !== 'no'));
    loadConfig().then(
      (c) => {
        config = c;
        probe(c).then(
          () => (serviceStatus = 'online'),
          () => (serviceStatus = 'offline'),
        );
      },
      (e: Error) => (fatal = e.message),
    );
    return () => window.removeEventListener('hashchange', onHash);
  });

  // A payment link must work for someone who has no Nostr identity at all.
  $effect(() => {
    if (route.name === 'pay' && config !== null && session === null && !busy && error === '') void signIn('guest');
  });
</script>

{#if setup !== null && (config !== null || fatal !== '') && session === null && route.name !== 'pay'}
  <!-- The service waits for its settings: walk the operator through them. -->
  <Setup status={setup} defaultRelays={config?.relays ?? []} {extension} {passkey} />
{:else}
<!-- The sign-in page has no header: just the form. -->
{#if session !== null || route.name === 'pay'}
<header class={operator ? 'site joined' : 'site'}>
  <div class="bar">
  <a class="brand" href="#/" aria-label={name}
    ><svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"
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
    ><span class="wordmark">deadhop</span>{#if shop}<span class="shop">{shop}</span>{/if}</a
  >
  {#if session}
    <span class="badge net">{session.info.network}</span>
    <span class="muted mono" title={session.pubkey}>{shortKey(nip19.npubEncode(session.pubkey))}</span>
    <button class="link" onclick={signOut}>Sign out</button>
  {/if}
  </div>
</header>
{/if}

{#if operator}
  <Admin
    api={session!.api}
    info={session!.info}
    onCreated={created}
    dashboardRelays={config!.adminRelays ?? config!.relays}
    serverPubkey={config!.serverPubkey}
    adminPubkey={config!.adminPubkey}
    onSettingsChanged={refreshInfo}
  />
{:else}
<main>
  {#if fatal}
    <p class="error" role="alert">{fatal}</p>
  {:else if config === null}
    <Loading label="Loading the dashboard" />
  {:else if session === null}
    {#if route.name === 'pay' && error === ''}
      <Loading label="Opening the invoice" />
    {:else}
      <Login onSignIn={signIn} {busy} {error} status={serviceStatus} passkey={passkeySignIn} />
    {/if}
  {:else if route.name === 'pay'}
    <Checkout api={session.api} id={route.id} />
  {:else if session.info.public_invoicing}
    <CreateInvoice api={session.api} info={session.info} onCreated={created} />
    <p class="muted">
      {`Signed in as ${shortKey(nip19.npubEncode(session.pubkey))}, which is not an operator of this service. To manage it, sign in with an operator key, or have an operator add this key under Settings → Operators.`}
    </p>
  {:else}
    <p class="card">This key is not an operator of this service, and public invoicing is switched off.</p>
  {/if}
</main>
{/if}

{#if config && session !== null && !operator}
  <!-- Lets anyone compare the key this page talks to with the one the merchant published. -->
  <footer class="muted">
    <ServiceKey pubkey={config.serverPubkey} compact />
  </footer>
{/if}

{/if}

<!-- On every page: what the dashboard is doing and waiting for. -->
<StatusBar raised={operator} />
