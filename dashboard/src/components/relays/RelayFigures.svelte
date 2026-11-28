<script lang="ts">
  import RelayBars from '@deadhop/network-ui/components/RelayBars.svelte';
  import { msText, type RelayRow } from '../../lib/relayview';

  // A relay's round trip (or its state when not connected), its day of results and its error rate.
  let { row, errors = false, parts = ['ms', 'bars', 'rate'] }: { row: RelayRow; errors?: boolean; parts?: ('ms' | 'bars' | 'rate')[] } = $props();
</script>

{#if parts.includes('ms')}
  {#if row.connected}
    <span class={`mono relay-ms ${row.ms !== null && row.ms >= 1000 ? 'slow' : ''}`}>{msText(row.ms)}</span>
  {:else}
    <span class="mono relay-ms down">{row.status}</span>
  {/if}
{/if}
{#if parts.includes('bars')}
  {#if row.stats}<RelayBars points={row.stats.points} label={`${row.url}, last day`} />{:else}<span class="bars-none" aria-hidden="true"></span>{/if}
{/if}
{#if parts.includes('rate')}
  {#if row.rate}<span class={`rate-chip ${row.rateTone}`} title="Failed health checks and replies, last 24 hours">{errors ? `${row.rate.text} errors` : row.rate.text}</span>{/if}
{/if}
