<script lang="ts">
  import { displayOrder } from '../lib/keys';
  import type { KeyInfo } from '../lib/schemas';
  import KeyTag from './KeyTag.svelte';

  // Which keys use a proxy or a group, with three keys or more: a summary
  // ("All keys", "3 of 4 keys") that opens the keys, each marked on or off.
  let {
    keys,
    used,
    label,
  }: {
    keys: KeyInfo[];
    /** The ids of the keys that use it. */
    used: string[];
    /** What it is, for screen readers. */
    label: string;
  } = $props();

  let open = $state(false);
</script>

{#if keys.length > 2 && used.length > 0}
  <span class="key-use">
    <button type="button" class="sm" aria-expanded={open} aria-label={`${label}: keys that use it`} onclick={() => (open = !open)}>{`${used.length === keys.length ? 'All keys' : `${used.length} of ${keys.length} keys`} ${open ? '▴' : '▾'}`}</button>
    {#if open}
      {#each displayOrder(keys) as k (k.id)}<KeyTag {keys} id={k.id} off={!used.includes(k.id)} />{/each}
    {/if}
  </span>
{/if}
