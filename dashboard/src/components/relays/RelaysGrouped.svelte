<script lang="ts">
  import { groupRows, type RelayRow } from '../../lib/relayview';
  import type { KeyInfo } from '../../lib/schemas';
  import KeyNames from './KeyNames.svelte';
  import RelayAddress from './RelayAddress.svelte';
  import RelayFigures from './RelayFigures.svelte';

  // The relays grouped by the keys that use them, each set of keys named once.
  let { rows, keys }: { rows: RelayRow[]; keys: KeyInfo[] } = $props();

  const groups = $derived(groupRows(rows, keys));
</script>

<div class="relay-groups">
  {#each groups as g (g.rows[0].url)}
    {@const tone = g.connected === 0 ? 'bad' : g.connected < g.rows.length ? 'warn' : 'ok'}
    <div class="relay-group">
      <div class="relay-group-head">
        <h3>{g.title}</h3>
        {#if g.keys.length > 0}<KeyNames {keys} ids={g.keys} />{/if}
        <span class={`group-health ${tone}`}>{`${g.connected} of ${g.rows.length} connected`}</span>
      </div>
      <ul class="plain">
        {#each g.rows as r (r.url)}
          <li>
            <div class="relay-main">
              <RelayAddress row={r} />
              {#if r.note}<span class={`relay-note ${r.tone}`}>{r.note}</span>{/if}
            </div>
            <div class="relay-figures"><RelayFigures row={r} /></div>
          </li>
        {/each}
      </ul>
    </div>
  {/each}
</div>
