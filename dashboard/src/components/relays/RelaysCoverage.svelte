<script lang="ts">
  import { keyColorClass, keyColors, displayOrder } from '@deadhop/network-ui/lib/keys';
  import { coverage, type RelayRow } from '../../lib/relayview';
  import type { KeyInfo } from '../../lib/schemas';
  import RelayAddress from './RelayAddress.svelte';
  import RelayFigures from './RelayFigures.svelte';

  // Relays down the side, keys across: a filled square where a key uses the relay,
  // and how many of each key's relays are connected along the bottom.
  let { rows, keys }: { rows: RelayRow[]; keys: KeyInfo[] } = $props();

  const colors = keyColors();
  const cols = $derived(displayOrder(keys));
  const counts = $derived(coverage(rows, keys));
</script>

<div class="scroll">
  <table class="relay-table relay-coverage">
    <thead>
      <tr>
        <th scope="col">Relay</th>
        {#each cols as k (k.id)}<th scope="col" class="key-col"><span class={keyColorClass(keys, k.id, colors)}><i aria-hidden="true"></i>{k.label}</span></th>{/each}
        <th scope="col" class="num">Round trip</th>
        <th scope="col" class="num">Errors</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as r (r.url)}
        <tr>
          <th scope="row">
            <RelayAddress row={r} />
            {#if r.note}<div class={`relay-note ${r.tone}`}>{r.note}</div>{/if}
          </th>
          {#each cols as k (k.id)}
            {@const on = r.keys.includes(k.id)}
            <td class="key-col"><i class={`cov ${keyColorClass(keys, k.id, colors)}`} class:off={!on} aria-hidden="true"></i><span class="visually-hidden">{on ? 'uses it' : 'does not use it'}</span></td>
          {/each}
          <td class="num"><RelayFigures row={r} parts={['ms']} /></td>
          <td class="num"><RelayFigures row={r} parts={['rate']} /></td>
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr>
        <th scope="row">Connected relays per key</th>
        {#each counts as c (c.id)}<td class={`key-col mono ${c.tone}`}>{`${c.connected} of ${c.total}`}</td>{/each}
        <td></td><td></td>
      </tr>
    </tfoot>
  </table>
</div>
