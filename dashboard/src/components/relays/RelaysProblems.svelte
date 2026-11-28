<script lang="ts">
  import { coverage, msText, servesText, type RelayRow } from '../../lib/relayview';
  import type { KeyInfo } from '../../lib/schemas';
  import RelayAddress from './RelayAddress.svelte';
  import RelayFigures from './RelayFigures.svelte';
  import RelayBars from '@deadhop/network-ui/components/RelayBars.svelte';

  // What needs a look first, in full; the relays that work as small tiles.
  let { rows, keys }: { rows: RelayRow[]; keys: KeyInfo[] } = $props();

  const problems = $derived(rows.filter((r) => r.problem));
  const healthy = $derived(rows.filter((r) => !r.problem));
  const connected = $derived(rows.filter((r) => r.connected).length);
  const reached = $derived(coverage(rows, keys).filter((c) => c.connected > 0).length);
  const tone = (n: number, of: number) => (n === 0 ? 'bad' : n < of ? 'warn' : 'ok');
</script>

<div class="relay-summary">
  <div><span class="lbl">Connected</span><span class={`big ${tone(connected, rows.length)}`}>{`${connected} of ${rows.length}`}</span></div>
  <div><span class="lbl">Keys with a relay</span><span class={`big ${tone(reached, keys.length)}`}>{`${reached} of ${keys.length}`}</span></div>
  <div><span class="lbl">Need a look</span><span class={`big ${problems.length === 0 ? 'ok' : 'warn'}`}>{problems.length}</span></div>
</div>

{#if problems.length === 0}
  <p class="hint">Nothing needs a look.</p>
{:else}
  <ul class="plain relay-problems">
    {#each problems as r (r.url)}
      <li class={`tone-${r.tone}`}>
        <div class="relay-main">
          <RelayAddress row={r} />
          {#if r.note}<span class={`relay-note ${r.tone}`}>{r.note}</span>{/if}
          <span class="muted">
            {`${servesText(r, keys)} · `}<RelayFigures row={r} parts={['ms']} />{#if r.rate}{' · '}<RelayFigures row={r} parts={['rate']} errors />{/if}
          </span>
        </div>
        {#if r.stats}<span class="bars-wide"><RelayBars points={r.stats.points} label={`${r.url}, last day`} /></span>{/if}
      </li>
    {/each}
  </ul>
{/if}

{#if healthy.length > 0}
  <h3 class="relay-sub-head">{`Working well · ${healthy.length}`}</h3>
  <ul class="plain relay-tiles">
    {#each healthy as r (r.url)}
      <li>
        <RelayAddress row={r} network={false} />
        <RelayFigures row={r} parts={['bars']} />
        <span class="tile-figures"><span class="mono">{msText(r.ms)}</span><RelayFigures row={r} parts={['rate']} /></span>
      </li>
    {/each}
  </ul>
{/if}
