<script lang="ts">
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import { formatSats, formatTime } from '@deadhop/network-ui/lib/format';
  import type { PayApi } from '../lib/api';
  import type { InvoiceKeyList, Settings } from '../lib/schemas';
  import { average, daysAgo, invoiceCount, monthName, monthStart, openCount, percent, sumTotals, yearStart } from '../lib/invoicekeys';
  import { colorClass } from '../lib/keycolors';
  import KeyChip from './KeyChip.svelte';

  type Period = 'week' | 'month' | 'year' | 'all';

  let { api, now, onBack }: { api: PayApi; now: () => number; onBack: () => void } = $props();

  let period = $state<Period>('month');
  let data = $state<{ period: InvoiceKeyList; all: InvoiceKeyList; day: InvoiceKeyList } | null>(null);
  /** The service's limits; optional, so a failure leaves the box out. */
  let limits = $state<Settings | null>(null);
  let error = $state('');

  const PERIODS: { value: Period; label: string }[] = $derived([
    { value: 'week', label: '7 days' },
    { value: 'month', label: monthName(now()) },
    { value: 'year', label: 'This year' },
    { value: 'all', label: 'All time' },
  ]);

  function since(p: Period): number | undefined {
    const t = now();
    return p === 'week' ? daysAgo(t, 7) : p === 'month' ? monthStart(t) : p === 'year' ? yearStart(t) : undefined;
  }

  // Runs on mount and again whenever the period changes.
  $effect(() => {
    const p = period;
    Promise.all([api.listInvoiceKeys(since(p)), api.listInvoiceKeys(), api.listInvoiceKeys(daysAgo(now(), 1))]).then(
      ([inPeriod, all, day]) => {
        data = { period: inPeriod, all, day };
        error = '';
      },
      (e: Error) => (error = e.message),
    );
  });

  $effect(() => {
    api.getSettings().then(
      (v) => (limits = v.settings),
      () => (limits = null),
    );
  });

  /** "Shop 3 · Café 1": the keys that have some, by label. */
  const perKey = (list: InvoiceKeyList, n: (k: InvoiceKeyList['keys'][number]) => number) =>
    list.keys
      .filter((k) => n(k) > 0)
      .map((k) => `${k.label} ${n(k)}`)
      .join(' · ');

  const heading = (p: Period, d: InvoiceKeyList) => (p === 'all' ? 'All time' : p === 'week' ? 'The last 7 days' : `Since ${formatTime(d.since).slice(0, 10)}`);
</script>

<header class="page-head">
  <div>
    <p class="eyebrow"><button class="link" onclick={onBack}>Keys</button> / ledger</p>
    <h1>Who took what</h1>
    <p class="muted">
      Takings per invoice key, for the invoices created in the period. Every key draws on the same wallet, so the total is what the wallet received through invoices.
    </p>
  </div>
  <div class="page-actions">
    <div class="segmented" role="group" aria-label="Period">
      {#each PERIODS as p (p.value)}
        <button class={period === p.value ? 'primary' : ''} aria-pressed={period === p.value} onclick={() => (period = p.value)}>{p.label}</button>
      {/each}
    </div>
  </div>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if data === null && !error}<Loading label="Loading the ledger" />{/if}

{#if data}
  {@const keys = data.period.keys}
  {@const total = sumTotals(keys.map((k) => k.totals))}
  <section class="card flush" aria-labelledby="l-share">
    <div class="card-head">
      <h2 id="l-share">{heading(period, data.period)}</h2>
      <span class="hint inline">received is confirmed payments</span>
    </div>
    {#if total.confirmed_sat > 0}
      <div class="share-bar" role="img" aria-label={keys.map((k) => `${k.label} ${percent(k.totals.confirmed_sat, total.confirmed_sat)}%`).join(', ')}>
        {#each keys as k (k.id)}
          {#if k.totals.confirmed_sat > 0}
            <span class={colorClass(k.color)} style:width={`${(k.totals.confirmed_sat * 100) / total.confirmed_sat}%`}></span>
          {/if}
        {/each}
      </div>
    {/if}
    <div class="scroll">
      <table class="data">
        <thead>
          <tr>
            <th>Key</th><th class="num">Invoices</th><th class="num">Paid</th><th class="num">Expired</th><th class="num">Received</th><th class="num">Share</th><th
              class="num">Average</th
            ><th>Last payment</th>
          </tr>
        </thead>
        <tbody>
          {#each keys as k (k.id)}
            <tr>
              <td>
                <KeyChip label={k.label} color={k.color} archived={k.archived_at !== null} />
                {#if k.archived_at !== null}<span class="hint inline">archived</span>{/if}
              </td>
              <td class="num">{invoiceCount(k.totals)}</td>
              <td class="num">{k.totals.confirmed}</td>
              <td class="num">{k.totals.expired}</td>
              <td class="num">{formatSats(k.totals.confirmed_sat)}</td>
              <td class="num">{`${percent(k.totals.confirmed_sat, total.confirmed_sat)}%`}</td>
              <td class="num">{formatSats(average(k.totals.confirmed_sat, k.totals.confirmed))}</td>
              <td class="muted">{k.totals.last_paid_at === null ? '—' : formatTime(k.totals.last_paid_at)}</td>
            </tr>
          {/each}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">All keys</th>
            <td class="num">{invoiceCount(total)}</td>
            <td class="num">{total.confirmed}</td>
            <td class="num">{total.expired}</td>
            <td class="num">{formatSats(total.confirmed_sat)}</td>
            <td class="num">{total.confirmed_sat > 0 ? '100%' : '0%'}</td>
            <td class="num">{formatSats(average(total.confirmed_sat, total.confirmed))}</td>
            <td class="muted">{total.last_paid_at === null ? '—' : formatTime(total.last_paid_at)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>

  {#if limits}
    {@const open = openCount(sumTotals(data.all.keys.map((k) => k.totals)))}
    {@const today = invoiceCount(sumTotals(data.day.keys.map((k) => k.totals)))}
    <section class="card" aria-labelledby="l-limits">
      <div class="card-head">
        <h2 id="l-limits">Shared limits</h2>
        <span class="hint inline">These are service-wide. One busy key uses them up for all.</span>
      </div>
      <div class="scroll">
        <table class="data">
          <tbody>
            <tr>
              <th scope="row">Open invoices</th>
              <td><meter min="0" max={limits.max_open_invoices} value={open} aria-label="Open invoices"></meter></td>
              <td class="num">{`${open} of ${limits.max_open_invoices}`}</td>
              <td class="hint">{perKey(data.all, (k) => openCount(k.totals))}</td>
            </tr>
            <tr>
              <th scope="row">Invoices in the last 24 hours</th>
              <td><meter min="0" max={limits.max_invoices_per_day} value={today} aria-label="Invoices in the last 24 hours"></meter></td>
              <td class="num">{`${today} of ${limits.max_invoices_per_day}`}</td>
              <td class="hint">{perKey(data.day, (k) => invoiceCount(k.totals))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint">Every invoice counts towards them, but operators are not held to them.</p>
    </section>
  {/if}
{/if}
