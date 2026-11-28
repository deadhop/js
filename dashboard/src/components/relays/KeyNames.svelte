<script lang="ts">
  import { keyColorClass, keyColors } from '@deadhop/network-ui/lib/keys';
  import { keyLabel } from '@deadhop/network-ui/lib/routeview';
  import type { KeyInfo } from '../../lib/schemas';

  // The keys that use a relay by name, each with its colour square, as quiet text.
  let { keys, ids }: { keys: KeyInfo[]; ids: string[] } = $props();

  const colors = keyColors();
</script>

<span class="key-names">
  {#each ids as id (id)}<span class={keyColorClass(keys, id, colors)}><i aria-hidden="true"></i>{keyLabel(keys, id)}</span>{/each}
</span>
