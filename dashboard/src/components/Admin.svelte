<script lang="ts">
  import type { PayApi } from '../lib/api';
  import type { Info, Invoice } from '../lib/schemas';
  import { setKeyColors } from '@deadhop/network-ui/lib/keys';
  import Invoices from './Invoices.svelte';
  import Keys from './Keys.svelte';
  import type { InvoiceKeyList } from '../lib/schemas';
  import Connectivity from '@deadhop/network-ui/components/Connectivity.svelte';
  import Maintenance from './Maintenance.svelte';
  import Operators from './Operators.svelte';
  import Overview from './Overview.svelte';
  import PrivacyAudit from '@deadhop/network-ui/components/PrivacyAudit.svelte';
  import Settings from './Settings.svelte';

  type Tab = 'overview' | 'privacy' | 'connectivity' | 'invoices' | 'keys' | 'network' | 'settings' | 'operators' | 'maintenance';
  type NetworkView = 'routes' | 'relays';

  let {
    api,
    info,
    onCreated,
    dashboardRelays,
    serverPubkey,
    adminPubkey,
    onSettingsChanged,
  }: {
    api: PayApi;
    info: Info;
    onCreated: (invoice: Invoice) => void;
    dashboardRelays: string[];
    serverPubkey: string;
    adminPubkey: string;
    onSettingsChanged: () => void;
  } = $props();

  let tab = $state<Tab>('overview');
  /** The key the Invoices list opens filtered to ('' is every key). */
  let invoiceKey = $state('');
  /** The view the Network tab opens on. */
  let networkView = $state<NetworkView>('routes');

  // The keys' stored colours, for every view below (the network views read them too).
  const colors = $state<Record<string, number>>({});
  setKeyColors(colors);
  function keysChanged(list: InvoiceKeyList) {
    for (const k of list.keys) colors[k.id] = k.color;
  }
  $effect(() => {
    // Optional: without them, keys take the colour of their place.
    Promise.resolve()
      .then(() => api.listInvoiceKeys())
      .then(keysChanged, () => undefined);
  });

  function openInvoices(id: string) {
    invoiceKey = id;
    tab = 'invoices';
  }
  function openNetwork(view: NetworkView) {
    networkView = view;
    tab = 'network';
  }
  function openTab(id: Tab) {
    // A tab opened from the bar starts as it always does.
    invoiceKey = '';
    networkView = 'routes';
    tab = id;
  }
  const TABS: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'invoices', label: 'Invoices' },
    { id: 'keys', label: 'Keys' },
    { id: 'network', label: 'Network' },
    { id: 'settings', label: 'Settings' },
    { id: 'operators', label: 'Operators' },
    { id: 'maintenance', label: 'Maintenance' },
  ];
</script>

<div class="tabbar">
  <nav class="tabs" aria-label="Operator">
    {#each TABS as t (t.id)}
      <button aria-current={tab === t.id || (['privacy', 'connectivity'].includes(tab) && t.id === 'overview') ? 'page' : undefined} onclick={() => openTab(t.id)}>{t.label}</button>
    {/each}
  </nav>
</div>

<main>

{#if tab === 'overview'}
  <Overview
    {api}
    {serverPubkey}
    {adminPubkey}
    onAudit={() => (tab = 'privacy')}
    onDrops={() => openInvoices('')}
    onConnectivity={() => (tab = 'connectivity')}
    onKeys={() => (tab = 'keys')}
    onRelays={() => openNetwork('relays')}
  />
{:else if tab === 'privacy'}
  <PrivacyAudit {api} onBack={() => (tab = 'overview')} />
{:else if tab === 'connectivity'}
  <Connectivity {api} onBack={() => (tab = 'overview')} />
{:else if tab === 'invoices'}
  {#key invoiceKey}<Invoices {api} {info} {onCreated} key={invoiceKey} />{/key}
{:else if tab === 'keys'}
  <Keys {api} {info} {adminPubkey} onInvoices={openInvoices} onNetwork={openNetwork} onChanged={keysChanged} />
{:else if tab === 'network'}
  {#key networkView}<Settings {api} {dashboardRelays} onChanged={onSettingsChanged} section="network" {networkView} />{/key}
{:else if tab === 'settings'}
  <Settings {api} {dashboardRelays} onChanged={onSettingsChanged} />
{:else if tab === 'operators'}
  <Operators {api} />
{:else}
  <Maintenance {api} />
{/if}
</main>
