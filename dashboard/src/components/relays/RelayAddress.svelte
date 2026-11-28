<script lang="ts">
  import type { RelayRow } from '../../lib/relayview';

  // A relay's dot and short address; the full address and its state are read out.
  let { row, network = true }: { row: RelayRow; network?: boolean } = $props();
</script>

<span class="relay-addr">
  <span class={`dot ${row.tone}`} aria-hidden="true"></span>
  <span class="mono relay-host" title={row.url} aria-hidden="true">{row.host}</span>
  <span class="visually-hidden">{`${row.url}, ${row.status}`}</span>
  {#if network}<span class="net-tag">{row.network}</span>{/if}
</span>
