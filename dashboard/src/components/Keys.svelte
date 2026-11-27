<script lang="ts">
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import { poll } from '@deadhop/network-ui/lib/poll';
  import { formatSats, formatTime, shortKey } from '@deadhop/network-ui/lib/format';
  import type { PayApi } from '../lib/api';
  import type { Health, Info, InvoiceKeyInfo, InvoiceKeyList } from '../lib/schemas';
  import { daysAgo, inUse, invoiceCount, nowSecs, npubOf, openCount, relayState, relayTone, shortNpub, totalsOf } from '../lib/invoicekeys';
  import { colorClass } from '../lib/keycolors';
  import AddKey from './AddKey.svelte';
  import KeyChip from './KeyChip.svelte';
  import KeyDetail from './KeyDetail.svelte';
  import Ledger from './Ledger.svelte';

  type NetworkView = 'routes' | 'relays';
  type View = { name: 'list' } | { name: 'add' } | { name: 'ledger' } | { name: 'detail'; id: string };

  let {
    api,
    info,
    adminPubkey,
    refreshMs = 15000,
    now = nowSecs,
    copy = (text: string) => navigator.clipboard.writeText(text),
    onInvoices,
    onNetwork,
    onChanged,
  }: {
    api: PayApi;
    info: Info;
    adminPubkey: string;
    refreshMs?: number;
    now?: () => number;
    copy?: (text: string) => Promise<void>;
    /** Open the Invoices tab, filtered to a key. */
    onInvoices: (id: string) => void;
    /** Open the Network tab. */
    onNetwork: (view: NetworkView) => void;
    /** The keys changed (added, renamed, recoloured, archived or restored). */
    onChanged: (list: InvoiceKeyList) => void;
  } = $props();

  let view = $state<View>({ name: 'list' });
  let data = $state<{ health: Health; all: InvoiceKeyList; recent: InvoiceKeyList } | null>(null);
  let error = $state('');
  let notice = $state('');
  let copied = $state('');
  let busy = $state(false);

  async function load() {
    try {
      const [health, all, recent] = await Promise.all([api.getHealth(), api.listInvoiceKeys(), api.listInvoiceKeys(daysAgo(now(), 30))]);
      data = { health, all, recent };
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  $effect(() => poll(load, refreshMs));

  /** After a change: tell Admin, and read the figures again. */
  async function changed(list: InvoiceKeyList) {
    onChanged(list);
    await load();
  }

  async function copyKey(id: string, npub: string) {
    try {
      await copy(npub);
      copied = id;
    } catch {
      copied = '';
      error = 'Could not copy: select the key and copy it by hand.';
    }
  }

  async function restore(k: InvoiceKeyInfo) {
    busy = true;
    notice = '';
    try {
      await changed(await api.restoreInvoiceKey(k.id));
      notice = `${k.label} is back, with the relays and routes of the original key.`;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  const adminKey = (h: Health) => h.keys.find((k) => k.id === 'admin')?.pubkey || adminPubkey;
  // The key whose page is open; read only on that page, once the keys are loaded.
  const picked = $derived(data!.all.keys.find((k) => view.name === 'detail' && k.id === view.id));
</script>

{#if view.name === 'add' && data}
  <AddKey
    {api}
    keys={data.all.keys}
    onCancel={() => (view = { name: 'list' })}
    onAdded={async (list, id) => {
      await changed(list);
      view = { name: 'detail', id };
    }}
  />
{:else if view.name === 'ledger'}
  <Ledger {api} {now} onBack={() => (view = { name: 'list' })} />
{:else if view.name === 'detail' && data && picked}
  <KeyDetail
    {api}
    {info}
    key={picked}
    recent={totalsOf(data.recent.keys, picked.id)}
    health={data.health}
    {now}
    {copy}
    onBack={() => (view = { name: 'list' })}
    onLedger={() => (view = { name: 'ledger' })}
    onInvoices={() => onInvoices(picked.id)}
    {onNetwork}
    onChanged={changed}
    onArchived={async (list) => {
      const label = picked.label;
      view = { name: 'list' };
      await changed(list);
      notice = `${label} is archived.`;
    }}
  />
{:else}
  <header class="page-head">
    <div>
      <p class="eyebrow">Keys</p>
      <h1>One address per service</h1>
      <p class="muted">
        Give each shop, site or app its own invoice key. Payments still land in the one wallet. Each key keeps its own ledger, relays and routes, so you can see at a glance which service took the money.
      </p>
    </div>
    {#if data}
      {@const full = inUse(data.all.keys).length >= data.all.max_keys}
      <button onclick={() => (view = { name: 'ledger' })}>Ledger</button>
      <button class="primary" disabled={full} title={full ? `All ${data.all.max_keys} invoice keys are in use. Archive one to add another.` : undefined} onclick={() => (view = { name: 'add' })}
        >Add invoice key</button
      >
    {/if}
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if notice}<p class="note" role="status">{notice}</p>{/if}
  {#if data === null && !error}<Loading label="Loading the keys" />{/if}

  {#if data}
    {@const live = inUse(data.all.keys)}
    {@const archived = data.all.keys.filter((k) => k.archived_at !== null)}
    {#if live.length >= data.all.max_keys}
      <p class="hint">{`All ${data.all.max_keys} invoice keys are in use. Archive one to add another.`}</p>
    {/if}
    <section aria-labelledby="k-keys">
      <h2 id="k-keys" class="keys-title">Invoice keys <span class="hint inline">{`${live.length} of ${data.all.max_keys}`}</span></h2>
      <div class="key-cards">
        {#each live as k (k.id)}
          {@const relays = relayState(data.health, k.id)}
          <article class="card key-card" aria-label={k.label}>
            <div class="row">
              <span class={`swatch ${colorClass(k.color)}`} aria-hidden="true"></span>
              <h3>{k.label}</h3>
              {#if k.original}<span class="pill">original</span>{/if}
            </div>
            {#if k.description !== ''}<p class="hint">{k.description}</p>{/if}
            <div class="key-addr">
              <code class="mono" title={npubOf(k.pubkey)}>{shortNpub(k.pubkey)}</code>
              {#if k.pubkey !== ''}
                <button class="sm" onclick={() => copyKey(k.id, npubOf(k.pubkey))}>{copied === k.id ? 'Copied' : 'Copy'}</button>
              {/if}
            </div>
            <dl class="facts">
              <dt>Relays</dt>
              <dd><span class={`dot ${relayTone(relays)}`} aria-hidden="true"></span> {`${relays.connected} of ${relays.urls.length} connected`}</dd>
              <dt>Open invoices</dt>
              <dd>{openCount(k.totals)}</dd>
              <dt>Received · 30 d</dt>
              <dd>{formatSats(totalsOf(data.recent.keys, k.id).confirmed_sat)}</dd>
              <dt>Public invoicing</dt>
              <dd>{`${k.public_invoicing ? 'on' : 'off'} · ${k.announce ? 'announced' : 'not announced'}`}</dd>
            </dl>
            <div class="row">
              <button class="sm" onclick={() => (view = { name: 'detail', id: k.id })}>Open</button>
              <button class="sm" onclick={() => onInvoices(k.id)}>Invoices</button>
            </div>
          </article>
        {/each}
      </div>
    </section>

    <section class="card admin-key" aria-label="Administration">
      <span class={`swatch ${colorClass(null)}`} aria-hidden="true"></span>
      <h3>Administration</h3>
      <code class="mono" title={npubOf(adminKey(data.health))}>{shortKey(npubOf(adminKey(data.health)))}</code>
      <span class="hint">Operators sign in here. It serves every tool, answers only operators and is never announced. There is one, and it cannot be archived.</span>
    </section>

    {#if archived.length > 0}
      <section class="card" aria-labelledby="k-archived">
        <div class="card-head">
          <h2 id="k-archived">Archived</h2>
          <span class="hint inline">Not connected and not serving. Their invoices stay in the ledger, and late payments are still watched.</span>
        </div>
        <div class="scroll">
          <table class="data">
            <tbody>
              {#each archived as k (k.id)}
                <tr>
                  <td><KeyChip label={k.label} color={k.color} archived /></td>
                  <td class="mono">{shortNpub(k.pubkey)}</td>
                  <td class="hint">{`archived ${formatTime(k.archived_at!)} · ${invoiceCount(k.totals)} invoices · ${formatSats(k.totals.confirmed_sat)}`}</td>
                  <td class="num">
                    <button class="sm" disabled={busy || live.length >= data.all.max_keys} onclick={() => restore(k)}>Restore</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}
  {/if}
{/if}
