<script lang="ts">
  import type { PayApi } from '../lib/api';
  import type { Info, Invoice, InvoiceKeyInfo } from '../lib/schemas';
  import { formatSats } from '@deadhop/network-ui/lib/format';
  import { inUse, invoiceCount, monthStart, nowSecs } from '../lib/invoicekeys';
  import KeyChip from './KeyChip.svelte';

  let {
    api,
    info,
    onCreated,
    defaultKey = '',
    now = nowSecs,
  }: {
    api: PayApi;
    info: Info;
    onCreated: (invoice: Invoice) => void;
    /** The invoice key to book it to unless the operator picks another (else the original one). */
    defaultKey?: string;
    now?: () => number;
  } = $props();

  /** The invoice keys in use, with this month's totals: operators choose which one to book an invoice to. */
  let keys = $state<InvoiceKeyInfo[]>([]);
  let chosen = $state('');
  $effect(() => {
    if (!info.is_admin) return;
    // Optional: without the list, the invoice goes to the original key as before.
    Promise.resolve()
      .then(() => api.listInvoiceKeys(monthStart(now())))
      .then(
        (l) => (keys = inUse(l.keys)),
        () => (keys = []),
      );
  });
  /** Whether there is a choice to make. */
  const choosing = $derived(keys.length > 1);
  /** The key it goes to: the one picked, else the default, else the original (listed first). */
  const picked = $derived(keys.find((k) => k.id === chosen) ?? keys.find((k) => k.id === defaultKey) ?? keys[0]);

  let amount = $state('');
  let memo = $state('');
  let busy = $state(false);
  let error = $state('');

  const mining = $derived(!info.is_admin && info.pow_bits > 0);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    const amount_sat = Number(amount);
    if (!Number.isInteger(amount_sat) || amount_sat < info.min_amount_sat || amount_sat > info.max_amount_sat) {
      error = `Enter a whole number between ${formatSats(info.min_amount_sat)} and ${formatSats(info.max_amount_sat)}.`;
      return;
    }
    busy = true;
    try {
      const text = memo.trim();
      const base = text === '' ? { amount_sat } : { amount_sat, memo: text };
      onCreated(await api.createInvoice(choosing ? { ...base, key: picked!.id } : base));
      amount = '';
      memo = '';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<section class="card">
  <h2>New invoice</h2>
  <form onsubmit={submit}>
    {#if choosing}
      <fieldset class="book-to">
        <legend>Book it to</legend>
        <div class="options">
          {#each keys as k (k.id)}
            <label class="option" class:on={picked === k}>
              <input type="radio" name="book-to" value={k.id} checked={picked === k} onchange={() => (chosen = k.id)} />
              <span><KeyChip label={k.label} color={k.color} /><br /><span class="hint">{`${invoiceCount(k.totals)} invoice${invoiceCount(k.totals) === 1 ? '' : 's'} this month`}</span></span>
            </label>
          {/each}
        </div>
        <p class="hint">You make this invoice from the dashboard, over the administration key. The key you choose here decides whose ledger it goes in, exactly as if that service had made it.</p>
      </fieldset>
    {/if}
    <label for="amount">Amount (sats)</label>
    <input id="amount" inputmode="numeric" autocomplete="off" placeholder={String(info.min_amount_sat)} bind:value={amount} />
    <label for="memo">Note (optional)</label>
    <input id="memo" maxlength="200" autocomplete="off" bind:value={memo} />
    <button class="primary" type="submit" disabled={busy}>{choosing ? `Create on ${picked!.label}` : 'Create invoice'}</button>
  </form>
  {#if busy}
    <p role="status">{mining ? `Computing proof of work (${info.pow_bits} bits)…` : 'Creating…'}</p>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>
