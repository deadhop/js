<script lang="ts">
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import { poll } from '@deadhop/network-ui/lib/poll';
  import type { PayApi } from '../lib/api';
  import type { Invoice } from '../lib/schemas';
  import { formatBtc, formatSats, receivedSummary, statusLabel, timeLeft } from '@deadhop/network-ui/lib/format';
  import Qr from './Qr.svelte';

  let {
    api,
    id,
    pollMs = 5000,
    clock = () => Math.floor(Date.now() / 1000),
    copy = (text: string) => navigator.clipboard.writeText(text),
  }: {
    api: PayApi;
    id: string;
    pollMs?: number;
    clock?: () => number;
    copy?: (text: string) => Promise<void>;
  } = $props();

  let invoice = $state<Invoice | null>(null);
  let error = $state('');
  let now = $state(0);
  let copied = $state(false);

  async function refresh(which: string) {
    now = clock();
    try {
      invoice = await api.getInvoice(which);
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  $effect(() => {
    // Read here, so another invoice loads again (the poll's own runs are untracked).
    const which = id;
    // A settled invoice never changes again.
    return poll(() => (invoice?.status === 'confirmed' ? Promise.resolve() : refresh(which)), pollMs);
  });

  async function copyAddress(address: string) {
    await copy(address);
    copied = true;
  }
</script>

<section class="card checkout">
  {#if invoice === null}
    {#if error}
      <p class="error" role="alert">{error}</p>
    {:else}
      <Loading label="Loading the invoice" />
    {/if}
  {:else}
    {@const payable = invoice.status === 'pending' || invoice.status === 'detected'}
    {@const remaining = timeLeft(invoice.expires_at, now)}
    <p class={`badge ${invoice.status}`} role="status">{statusLabel(invoice.status)}</p>
    <h2>{formatBtc(invoice.amount_sat)}</h2>
    <p class="muted">{formatSats(invoice.amount_sat)}</p>
    {#if invoice.memo}
      <!-- Written by whoever created the invoice, which may be a stranger. -->
      <p class="note"><span class="muted">Note from the invoice creator:</span> <span>{invoice.memo}</span></p>
    {/if}

    {#if payable}
      <a class="qr-link" href={invoice.bip21} aria-label="Open in wallet">
        <Qr text={invoice.bip21} label="Payment QR code" />
      </a>
      <p class="address">{invoice.address}</p>
      <button onclick={() => copyAddress(invoice!.address)}>{copied ? 'Copied' : 'Copy address'}</button>
      {#if invoice.status === 'pending' && remaining}<p class="muted">{`Expires in ${remaining}`}</p>{/if}
    {/if}

    {#if invoice.received_sat > 0}
      <p>{receivedSummary(invoice)}</p>
    {/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</section>
