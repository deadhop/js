<script lang="ts">
  import { colorClass } from '../lib/keycolors';

  // A key's name with its colour square; `color` null is the administration key.
  let { label, color, archived = false }: { label: string; color: number | null; archived?: boolean } = $props();
</script>

<span class={`key-tag ${colorClass(color)}`} class:off={archived}><i aria-hidden="true"></i>{label}</span>
