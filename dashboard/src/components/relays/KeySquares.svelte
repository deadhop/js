<script lang="ts">
  import { keyColorClass, keyColors, labelList } from '@deadhop/network-ui/lib/keys';
  import { keyLabel } from '@deadhop/network-ui/lib/routeview';
  import type { KeyInfo } from '../../lib/schemas';

  // The keys that use a relay as small colour squares, named on hover and to screen readers.
  let { keys, ids }: { keys: KeyInfo[]; ids: string[] } = $props();

  const colors = keyColors();
</script>

<span class="key-squares">
  {#each ids as id (id)}<i class={keyColorClass(keys, id, colors)} title={keyLabel(keys, id)} aria-hidden="true"></i>{/each}
  <span class="visually-hidden">{labelList(ids.map((id) => keyLabel(keys, id)))}</span>
</span>
