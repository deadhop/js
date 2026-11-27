<script lang="ts">
  import type { Snippet } from 'svelte';
  import { dependents, displayOrder, isOperators, relayUsers, relaysOf } from '../lib/keys';
  import type { KeyInfo, NetworkSettings } from '../lib/schemas';
  import KeyTag from './KeyTag.svelte';

  // The relays and the keys that use them: one row per relay, one column per
  // key (the administration key first, then the invoice keys). Everything on
  // is saved as "all keys". A key that would have no relay left, or the
  // administration key on the last relay this page connects through, stays
  // on; so does a relay's last key (removing the relay is its own button).
  // The relay column stays put and the key columns scroll when narrow.
  let {
    keys,
    relays,
    relayKeys,
    dashboardRelays,
    onuse,
    relay,
    route,
    panel,
    panelOpen,
  }: {
    keys: KeyInfo[];
    relays: string[];
    relayKeys: NetworkSettings['relay_keys'];
    /** Relays this page connects through. */
    dashboardRelays: string[];
    /** Switch one key on or off for a relay. */
    onuse: (url: string, id: string, on: boolean) => void;
    /** The relay's own cell: its address or name, its error rate, its last check. */
    relay: Snippet<[string]>;
    /** How the relay goes, and its buttons. */
    route: Snippet<[string]>;
    /** A panel under the relay (why it goes this way, a lookup), shown while `panelOpen` says so. */
    panel: Snippet<[string]>;
    panelOpen: (url: string) => boolean;
  } = $props();

  const ids = $derived(keys.map((k) => k.id));
  const cols = $derived(displayOrder(keys));
  const operators = $derived(cols.filter(isOperators).length);
  const matrix = $derived(cols.length > 1);
  const span = $derived(matrix ? cols.length + 2 : 2);
  const WHY = 'its only relay, or the only one this page connects through, so it stays on.';

  /** Switch a key on for every relay. */
  function all(id: string) {
    for (const r of relays) if (!relayUsers(relayKeys, r, ids).includes(id)) onuse(r, id, true);
  }
</script>

<div class="relay-matrix-wrap relay-edit">
  <table class="relay-matrix" aria-label="Relays and the keys that use them">
    <thead>
      {#if matrix}
        <tr class="grp">
          <th class="rl"></th>
          {#if operators > 0}<th colspan={operators}>Operators</th>{/if}
          {#if cols.length > operators}<th class="gs" colspan={cols.length - operators}>Invoice keys</th>{/if}
          <th class="gs"></th>
        </tr>
      {/if}
      <tr>
        <th class="rl" scope="col">Relay</th>
        {#if matrix}
          {#each cols as k, i (k.id)}
            <th scope="col" class:gs={i === operators}><KeyTag {keys} id={k.id} /></th>
          {/each}
        {/if}
        <th class="gs route" scope="col">Route</th>
      </tr>
    </thead>
    <tbody>
      {#each relays as r (r)}
        {@const users = relayUsers(relayKeys, r, ids)}
        {@const required = dependents(relays, relayKeys, r, ids, dashboardRelays)}
        <tr>
          <th class="rl" scope="row"><div class="relay-cell">{@render relay(r)}</div></th>
          {#if matrix}
            {#each cols as k, i (k.id)}
              {@const on = users.includes(k.id)}
              {@const pinned = on && required.includes(k.id)}
              {@const last = on && users.length === 1}
              <td class="c" class:gs={i === operators}>
                <label class="mx-cell" class:on class:pinned title={pinned ? `${k.label}: ${WHY}` : last ? `${k.label}: the relay's last key. Remove the relay instead.` : undefined}>
                  <input type="checkbox" checked={on} disabled={last || pinned} onchange={(e) => onuse(r, k.id, e.currentTarget.checked)} aria-label={`${r} used by ${k.label}`} />
                </label>
              </td>
            {/each}
          {/if}
          <td class="gs route"><div class="relay-actions">{@render route(r)}</div></td>
        </tr>
        {#if panelOpen(r)}
          <tr class="relay-panel"><td colspan={span}>{@render panel(r)}</td></tr>
        {/if}
      {/each}
    </tbody>
    {#if matrix}
      <tfoot>
        <tr>
          <th class="rl" scope="row">Relays per key</th>
          {#each cols as k, i (k.id)}
            {@const n = relaysOf(relays, relayKeys, k.id, ids).length}
            <td class:gs={i === operators}>
              {#if n > 1}{`${n}`}{:else}<span class="few">{`${n} · add ${n === 0 ? 'one' : 'another'}`}</span>{/if}
            </td>
          {/each}
          <td class="gs"></td>
        </tr>
        <tr>
          <th class="rl" scope="row">Whole column</th>
          {#each cols as k, i (k.id)}
            <td class:gs={i === operators}>
              <button type="button" class="sm" aria-label={`Use every relay for ${k.label}`} disabled={relaysOf(relays, relayKeys, k.id, ids).length === relays.length} onclick={() => all(k.id)}>All</button>
            </td>
          {/each}
          <td class="gs"></td>
        </tr>
      </tfoot>
    {/if}
  </table>
</div>
{#if matrix}
  <p class="hint mx-legend">
    <span><span class="mx-cell on" aria-hidden="true"></span>uses this relay</span>
    <span><span class="mx-cell" aria-hidden="true"></span>does not</span>
    <span><span class="mx-cell on pinned" aria-hidden="true"></span>must stay on (hover for why)</span>
  </p>
{/if}
