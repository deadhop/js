<script lang="ts">
  import { untrack } from 'svelte';
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import { poll } from '@deadhop/network-ui/lib/poll';
  import type { PayApi } from '../lib/api';
  import type { AdminInvoice, Info, Invoice, InvoiceKeyInfo, Stats, Status } from '../lib/schemas';
  import { shortNpub, totalsOf } from '../lib/invoicekeys';
  import KeyChip from './KeyChip.svelte';
  import { dropId, formatSats, formatShortTime, formatTime, shortKey, statusLabel } from '@deadhop/network-ui/lib/format';
  import { payHash } from '../lib/route';
  import CreateInvoice from './CreateInvoice.svelte';
  import Qr from './Qr.svelte';

  let {
    api,
    info,
    onCreated,
    refreshMs = 15000,
    key = '',
    copy = (text: string) => navigator.clipboard.writeText(text),
  }: {
    api: PayApi;
    info: Info;
    onCreated: (invoice: Invoice) => void;
    refreshMs?: number;
    /** The invoice key the list starts filtered to ('' is every key). */
    key?: string;
    copy?: (text: string) => Promise<void>;
  } = $props();

  let stats = $state<Stats | null>(null);
  let invoices = $state<AdminInvoice[]>([]);
  let nextBefore = $state<number | null>(null);
  let filter = $state<Status | ''>('');
  /** The invoice key the list shows ('' is every key). */
  let keyFilter = $state(untrack(() => key));
  /** The invoice keys, with their totals of all time; optional, so a failure leaves the filter out. */
  let keys = $state<InvoiceKeyInfo[]>([]);
  let query = $state('');
  let error = $state('');
  /** Whether the list has been loaded once. */
  let loaded = $state(false);
  let pickedId = $state('');
  let creating = $state(false);
  let copied = $state('');

  const FILTERS: [Status | '', string][] = [
    ['', 'All'],
    ['pending', 'Awaiting payment'],
    ['detected', 'Confirming'],
    ['confirmed', 'Paid'],
    ['expired', 'Expired'],
  ];

  function count(s: Pick<Stats, Status>, value: Status | ''): number {
    return value === '' ? s.pending + s.detected + s.confirmed + s.expired : s[value];
  }

  /** The loaded drops that match the search box (drop id, address, note or invoice id). */
  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return invoices;
    return invoices.filter((i) => [dropId(i.index), i.address, i.memo, i.id].some((field) => field.toLowerCase().includes(q)));
  });
  /** The drop shown beside the list: the one picked, else the first one listed. */
  const picked = $derived(visible.find((i) => i.id === pickedId) ?? visible[0] ?? null);

  /** Progress of a drop: created, seen, confirmed. Done steps are solid; the one in transit is dashed. */
  function steps(inv: AdminInvoice): [string, string][] {
    const reached = { pending: 1, detected: 2, confirmed: 3, expired: 1 }[inv.status];
    return (['created', 'seen', 'confirmed'] as const).map((label, i) => [
      label,
      i < reached ? 'done' : i === reached && inv.status !== 'expired' ? 'transit' : 'todo',
    ]);
  }

  function sentence(inv: AdminInvoice): string {
    const n = inv.confirmations_required;
    switch (inv.status) {
      case 'pending':
        return 'Waiting for payment. Nothing seen on the chain yet.';
      case 'detected':
        return `Payment seen. Waiting for ${n} confirmation${n === 1 ? '' : 's'}.`;
      case 'confirmed':
        return 'Paid and confirmed.';
      default:
        return 'Expired unpaid. A late payment would still be credited.';
    }
  }

  /** What the list asks for: a status, a key, and (when there are keys to tell apart) the key of every row. */
  const params = (which: Status | '', id: string, keyed: boolean) => ({
    ...(which === '' ? {} : { status: which }),
    ...(id === '' ? {} : { key: id }),
    ...(keyed ? { with_key: true } : {}),
  });

  /** Whether there is more than one invoice key to tell apart (archived ones included). */
  const several = $derived(keys.length > 1);
  /** The status counts: the service's, or the filtered key's. */
  const counts = $derived(keyFilter === '' || keys.length === 0 ? stats : totalsOf(keys, keyFilter));
  const keyOf = (id: string | undefined) => keys.find((k) => k.id === id);

  async function load(which: Status | '' = filter, id: string = keyFilter) {
    try {
      // The keys first: a service without invoice keys does not know `with_key`.
      const list = await Promise.resolve()
        .then(() => api.listInvoiceKeys())
        .then(
          (l) => l.keys,
          () => keys,
        );
      const [s, page] = await Promise.all([api.getStats(), api.listInvoices(params(which, id, list.length > 1))]);
      stats = s;
      keys = list;
      invoices = page.invoices;
      nextBefore = page.next_before;
      loaded = true;
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function loadMore(before: number) {
    try {
      const page = await api.listInvoices({ ...params(filter, keyFilter, several), before });
      invoices = [...invoices, ...page.invoices];
      nextBefore = page.next_before;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  async function copyText(what: string, text: string) {
    try {
      await copy(text);
      copied = what;
    } catch {
      copied = '';
      error = 'Could not copy: select the text and copy it by hand.';
    }
  }

  // Runs on mount and again whenever the status or key filter changes.
  $effect(() => {
    // Read here, so a new filter loads again (the poll's own runs are untracked).
    const which = filter;
    const id = keyFilter;
    return poll(() => load(which, id), refreshMs);
  });
</script>

<header class="page-head">
  <div>
    <p class="eyebrow">Invoices</p>
    <h1>Drops</h1>
    <p class="muted">Every invoice is a drop: one fresh address, left for the customer to pay into.</p>
  </div>
  <button onclick={() => load()}>Refresh</button>
  <button class="primary" aria-expanded={creating} onclick={() => (creating = !creating)}>New invoice</button>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if stats && stats.watch_errors > 0}
  <p class="error" role="alert">
    {`${stats.watch_errors} open invoice${stats.watch_errors === 1 ? '' : 's'} could not be read from the chain and need a look (see the service log).`}
  </p>
{/if}

{#if creating}
  <CreateInvoice {api} {info} {onCreated} defaultKey={keyFilter} />
{/if}

<div class="toolbar">
  <label class="visually-hidden" for="find">Find a drop</label>
  <input id="find" type="search" placeholder="Drop, address or note" bind:value={query} />
  <div class="segmented" role="group" aria-label="Status">
    {#each FILTERS as [value, label] (value)}
      <button class={filter === value ? 'primary' : ''} aria-pressed={filter === value} onclick={() => (filter = value)}
        >{label}{#if counts}<span class="count" aria-hidden="true">{`${count(counts, value)}`}</span>{/if}</button
      >
    {/each}
  </div>
  {#if several}
    <label class="inline-select" for="key-filter">Key</label>
    <select id="key-filter" bind:value={keyFilter}>
      <option value="">All keys</option>
      {#each keys.filter((k) => k.archived_at === null) as k (k.id)}
        <option value={`${k.id}`}>{`${k.label}`}</option>
      {/each}
      {#each keys.filter((k) => k.archived_at !== null) as k (k.id)}
        <option value={`${k.id}`}>{`Archived: ${k.label}`}</option>
      {/each}
    </select>
  {/if}
</div>

<div class="split">
  <section class="card flush drops" aria-label="Invoice list">
    {#if !loaded && !error}
      <Loading label="Loading invoices" />
    {:else if visible.length === 0}
      <p class="muted empty">{invoices.length === 0 ? 'No invoices yet.' : 'No drop matches the search.'}</p>
    {:else}
      <div class="scroll">
        <table class="data">
          <thead>
            <tr><th>Drop</th>{#if several}<th>Key</th>{/if}<th>Status</th><th>Note</th><th class="num">Amount</th><th>Created</th></tr>
          </thead>
          <tbody>
            {#each visible as inv (inv.id)}
              <tr class={inv === picked ? 'on' : ''}>
                <td><button class="link mono" aria-pressed={inv === picked} onclick={() => (pickedId = inv.id)} title={`Address index ${inv.index}`}>{dropId(inv.index)}</button></td>
                {#if several}
                  {@const k = keyOf(inv.key)}
                  <td>{#if k}<KeyChip label={k.label} color={k.color} archived={k.archived_at !== null} />{:else}<span class="muted">—</span>{/if}</td>
                {/if}
                <td><span class={`badge ${inv.status}`}>{statusLabel(inv.status)}</span></td>
                <td class="memo">{inv.memo}</td>
                <td class="num">{formatSats(inv.amount_sat)}</td>
                <td class="muted" title={formatTime(inv.created_at)}>{formatShortTime(inv.created_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if several && keyFilter !== ''}
      <p class="hint pad">
        {`Filtered to ${keyOf(keyFilter)?.label ?? keyFilter}.`}
        <button class="link" onclick={() => (keyFilter = '')}>Show all keys</button>
      </p>
    {/if}
    {#if nextBefore !== null}
      <div class="more"><button onclick={() => loadMore(nextBefore!)}>Load more</button></div>
    {/if}
  </section>

  {#if picked}
    <aside class="card drop-detail" aria-label={`Drop ${dropId(picked.index)}`}>
      <div class="tile-top">
        <span class="mono muted">{`DROP ${dropId(picked.index)}`}</span>
        <span class={`badge ${picked.status}`}>{statusLabel(picked.status)}</span>
      </div>
      <p class="drop-amount">{formatSats(picked.amount_sat)}</p>
      {#if picked.memo}<p class="muted">Note from the invoice creator: <span class="memo-text">{picked.memo}</span></p>{/if}
      <div class="drop-pay">
        {#if picked.status === 'pending' || picked.status === 'detected'}
          <div class="drop-qr"><Qr text={picked.bip21} label={`QR code for paying drop ${dropId(picked.index)}`} /></div>
        {/if}
        <div class="drop-address">
          <span class="lbl">Address</span>
          <span class="mono address">{picked.address}</span>
          <button onclick={() => copyText('address', picked!.address)}>{copied === 'address' ? 'Copied' : 'Copy address'}</button>
        </div>
      </div>
      <div>
        <span class="lbl">Progress</span>
        <ol class="progress">
          {#each steps(picked) as [label, state] (label)}
            <li class={state}>{label}</li>
          {/each}
        </ol>
        <p>{sentence(picked)}</p>
      </div>
      <dl class="facts">
        <dt>Created</dt><dd>{formatTime(picked.created_at)}</dd>
        <dt>Expires</dt><dd>{formatTime(picked.expires_at)}</dd>
        <dt>Received</dt><dd>{formatSats(picked.received_sat)}</dd>
        <dt>Index</dt><dd class="mono">{picked.index}</dd>
        <dt>By</dt><dd class="mono" title={picked.creator}>{shortKey(picked.creator)}</dd>
        {#if several}
          {@const k = keyOf(picked.key)}
          <dt>Came in on</dt>
          <dd>
            {#if k}<KeyChip label={k.label} color={k.color} archived={k.archived_at !== null} /> <span class="mono muted">{shortNpub(k.pubkey)}</span>{:else}<span class="muted">—</span>{/if}
          </dd>
        {/if}
      </dl>
      <div class="row">
        <a href={payHash(picked.id)}>Open payment page</a>
        <button class="link" onclick={() => copyText('link', `${location.origin}${location.pathname}${payHash(picked!.id)}`)}
          >{copied === 'link' ? 'Copied' : 'Copy payment link'}</button
        >
      </div>
    </aside>
  {/if}
</div>
