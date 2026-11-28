<script lang="ts">
  import { servesText, type RelayRow } from '../../lib/relayview';
  import type { KeyInfo } from '../../lib/schemas';
  import KeySquares from './KeySquares.svelte';
  import RelayAddress from './RelayAddress.svelte';
  import RelayFigures from './RelayFigures.svelte';

  // One row per relay, every value in its own column.
  let { rows, keys }: { rows: RelayRow[]; keys: KeyInfo[] } = $props();
</script>

<div class="scroll">
  <table class="relay-table relay-columns">
    <thead>
      <tr><th scope="col">Relay</th><th scope="col">Network</th><th scope="col">Serves</th><th scope="col" class="num">Round trip</th><th scope="col">Last day</th><th scope="col" class="num">Errors</th></tr>
    </thead>
    <tbody>
      {#each rows as r (r.url)}
        <tr>
          <td>
            <RelayAddress row={r} network={false} />
            {#if r.note}<div class={`relay-note ${r.tone}`}>{r.note}</div>{/if}
          </td>
          <td class="muted">{r.network}</td>
          <td><span class="serves"><KeySquares {keys} ids={r.keys} /><span>{servesText(r, keys)}</span></span></td>
          <td class="num"><RelayFigures row={r} parts={['ms']} /></td>
          <td><RelayFigures row={r} parts={['bars']} /></td>
          <td class="num"><RelayFigures row={r} parts={['rate']} /></td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
