<script lang="ts">
  import { keyColorClass, keyColors } from '../lib/keys';
  import { keyLabel } from '../lib/routeview';
  import type { KeyInfo } from '../lib/schemas';

  // Small badges naming the keys that use a relay or a proxy. Nothing is shown
  // when every key does (the usual case), so a restriction stands out.
  let { keys, total, all = [] }: { keys: string[]; total: number; /** The service's keys, for their labels and colours. */ all?: KeyInfo[] } = $props();

  const colors = keyColors();
</script>

{#if keys.length > 0 && keys.length < total}
  <span class="key-badges">{#each keys as k (k)}<span class={`badge key ${keyColorClass(all, k, colors)}`}><i aria-hidden="true"></i>{keyLabel(all, k)}</span>{/each}</span>
{/if}
