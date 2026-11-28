<script lang="ts">
  import { loadRelayView, RELAY_VIEWS, relayRows, saveRelayView, type RelayView } from '../../lib/relayview';
  import type { Health, RelayHistory } from '../../lib/schemas';
  import RelaysColumns from './RelaysColumns.svelte';
  import RelaysCoverage from './RelaysCoverage.svelte';
  import RelaysGrouped from './RelaysGrouped.svelte';
  import RelaysProblems from './RelaysProblems.svelte';
  import RelaysRows from './RelaysRows.svelte';

  // The Relays card's head and body. The operator picks one of five views; this
  // browser remembers the pick.
  let {
    health,
    history,
    checking,
    oncheck,
    onConnectivity,
  }: {
    health: Health;
    /** A day of relay results, or null when it could not be read. */
    history: RelayHistory | null;
    checking: boolean;
    oncheck: () => void;
    onConnectivity: () => void;
  } = $props();

  let view = $state<RelayView>(loadRelayView());
  const rows = $derived(relayRows(health, history));

  function pick(v: RelayView) {
    view = v;
    saveRelayView(v);
  }
</script>

<div class="card-head">
  <h2 id="o-relays">Relays</h2>
  <label class="inline-select" for="relay-view">View</label>
  <select id="relay-view" onchange={(e) => pick(e.currentTarget.value as RelayView)}>
    {#each RELAY_VIEWS as v (v.value)}<option value={`${v.value}`} selected={v.value === view}>{`${v.label}`}</option>{/each}
  </select>
  <button class="small" onclick={onConnectivity}>Connectivity</button>
  <button class="small" onclick={oncheck} disabled={checking}>{checking ? 'Checking…' : 'Check now'}</button>
</div>
<p class="hint relay-hint">One working relay per key is enough. Each is checked end to end every 5 minutes.</p>
<div class={`relay-view ${view}`}>
  {#if view === 'rows'}
    <RelaysRows {rows} keys={health.keys} />
  {:else if view === 'groups'}
    <RelaysGrouped {rows} keys={health.keys} />
  {:else if view === 'problems'}
    <RelaysProblems {rows} keys={health.keys} />
  {:else if view === 'coverage'}
    <RelaysCoverage {rows} keys={health.keys} />
  {:else}
    <RelaysColumns {rows} keys={health.keys} />
  {/if}
</div>
