<script lang="ts">
  import type { RelayRow } from '../../lib/relayview';
  import type { KeyInfo } from '../../lib/schemas';
  import KeyNames from './KeyNames.svelte';
  import RelayAddress from './RelayAddress.svelte';
  import RelayFigures from './RelayFigures.svelte';

  // Two lines per relay: its address, then the keys that use it, with the figures on the right.
  let { rows, keys }: { rows: RelayRow[]; keys: KeyInfo[] } = $props();
</script>

<ul class="plain relay-rows">
  {#each rows as r (r.url)}
    <li>
      <div class="relay-main">
        <RelayAddress row={r} />
        <div class="relay-sub">
          {#if r.every}<span class="muted">All keys</span>{:else}<KeyNames {keys} ids={r.keys} />{/if}
          {#if r.note}<span class={`relay-note ${r.tone}`}>{r.note}</span>{/if}
        </div>
      </div>
      <div class="relay-figures"><RelayFigures row={r} errors /></div>
    </li>
  {/each}
</ul>
