<script lang="ts">
  import { keyColorClass, keyColors } from '../lib/keys';
  import { keyLabel } from '../lib/routeview';
  import type { KeyInfo } from '../lib/schemas';

  // A key's name with its colour square. `off` draws it hollow: the key does not use the thing.
  let { keys, id, off = false }: { keys: KeyInfo[]; id: string; off?: boolean } = $props();

  const colors = keyColors();
</script>

<span class={`key-tag ${keyColorClass(keys, id, colors)}`} class:off><i aria-hidden="true"></i>{keyLabel(keys, id)}</span>
