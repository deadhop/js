<script lang="ts">
  import { displayOrder, isOperators, relaysOf } from '../lib/keys';
  import { defaultFor, destination } from '../lib/routes';
  import type { KeyInfo, NetworkSettings } from '../lib/schemas';
  import KeyTag from './KeyTag.svelte';

  // The keys, one small box each: what the key is for, how many relays it
  // uses (one or none stands out) and where everything else goes.
  let {
    keys,
    form,
    purposes = {},
  }: {
    keys: KeyInfo[];
    form: Pick<NetworkSettings, 'relays' | 'relay_keys' | 'proxies'>;
    /** A line per key id saying what it is for; a general one otherwise. */
    purposes?: Record<string, string>;
  } = $props();

  const ids = $derived(keys.map((k) => k.id));
  const purpose = (k: KeyInfo) => purposes[k.id] ?? (isOperators(k) ? 'Operators sign in here.' : 'Customers and apps create invoices here.');
</script>

<ul class="plain key-legend" aria-label="Keys">
  {#each displayOrder(keys) as k (k.id)}
    {@const n = relaysOf(form.relays, form.relay_keys, k.id, ids).length}
    <li>
      <KeyTag {keys} id={k.id} />
      <span class="hint">
        {`${purpose(k)} `}<span class:few={n < 2}>{n === 1 ? '1 relay' : `${n} relays`}</span>{` · everything else: ${destination(defaultFor(form.proxies, k.id), form.proxies).toLowerCase()}`}
      </span>
    </li>
  {/each}
</ul>
