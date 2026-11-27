<script lang="ts">
  import { GROUP_MIN, MAX_GROUPS, STRATEGIES, groupId, isNew, move, newGroup, shortDuration } from '../lib/proxy';
  import { groupName, keysUsing, proxyName, usedBy } from '../lib/routes';
  import { groupSummaries, keyLabel } from '../lib/routeview';
  import type { KeyInfo, ProxyGroup, ProxyPool, ProxySettings } from '../lib/schemas';
  import Duration from './Duration.svelte';
  import KeyUse from './KeyUse.svelte';

  // Proxy groups: two or more proxies, in order, and the strategy that picks
  // one of them. A rule or the default route uses a group by pointing at it.
  let {
    keys,
    proxies,
    live,
    pool,
  }: {
    keys: KeyInfo[];
    /** The form's proxy settings (changed in place). */
    proxies: ProxySettings;
    /** The saved ones, to tell which groups are not saved yet. */
    live: ProxySettings;
    pool: ProxyPool | null;
  } = $props();

  const summaries = $derived(groupSummaries(proxies, pool, keys));

  function change(gi: number, over: Partial<ProxyGroup>) {
    proxies.groups = proxies.groups.map((g, j) => (j === gi ? { ...g, ...over } : g));
  }

  function create() {
    const name = `Group ${proxies.groups.length + 1}`;
    // Start with the first two proxies that are not the I2P router (it carries only .i2p relays).
    const members = [...proxies.list.filter((e) => e.i2p !== true), ...proxies.list.filter((e) => e.i2p === true)].slice(0, GROUP_MIN).map((e) => e.id);
    proxies.groups = [...proxies.groups, newGroup(name, members, proxies.groups.map((g) => g.id))];
  }

  /** A group not saved yet that nothing points at takes its id from its name once the name is typed. */
  function settle(gi: number) {
    const g = proxies.groups[gi];
    if (!isNew(g, live.groups) || usedBy(proxies, { group: g.id }, keys).length > 0) return;
    const id = groupId(g.name, proxies.groups.filter((_, j) => j !== gi).map((x) => x.id));
    if (id !== g.id) change(gi, { id });
  }

  const remove = (gi: number) => (proxies.groups = proxies.groups.filter((_, j) => j !== gi));
  const nameOf = (id: string) => proxyName(proxies.list.find((e) => e.id === id)!);
</script>

<div class="field groups" role="group" aria-labelledby="groups-title">
  <span class="field-title" id="groups-title">Groups</span>
  <p class="hint">
    A group is two or more proxies and a way of picking one of them: failover, round-robin or chaos. To use a group, point a rule or the default route at it under Rules. A
    proxy can be in several groups.
  </p>
  {#if proxies.groups.length === 0}
    <p class="muted">No groups. Every rule and the default route goes through a single proxy, or none.</p>
  {/if}
  <ol class="proxy-list group-list">
    {#each proxies.groups as g, gi (g.id)}
      {@const used = usedBy(proxies, { group: g.id }, keys)}
      {@const s = summaries[gi]}
      {@const label = groupName(g)}
      {@const addable = proxies.list.filter((e) => !g.proxies.includes(e.id))}
      <li class="proxy-row group-row">
        <span class="pos mono" aria-hidden="true">{gi + 1}</span>
        <span class="proxy-id">
          <span class="proxy-name">{label}{#if isNew(g, live.groups)}<span class="badge not_checked">not saved</span>{/if}</span>
          <span class="hint">{used.length === 0 ? 'Nothing points at it yet.' : `Used by ${used.join(', ')}.`}</span>
          <KeyUse {keys} used={keysUsing(proxies, { group: g.id }, keys)} label={`Group ${label}`} />
        </span>
        <div class="group-body">
          <div class="field">
            <label for={`group-name-${g.id}`}>Name</label>
            <input id={`group-name-${g.id}`} maxlength="60" value={g.name} oninput={(e) => change(gi, { name: e.currentTarget.value })} onchange={() => settle(gi)} />
          </div>
          <span class="field-title" id={`group-members-${g.id}`}>Proxies, in order</span>
          <ol class="plain group-members" aria-labelledby={`group-members-${g.id}`}>
            {#each g.proxies as id, mi (id)}
              <li>
                <span class="pos mono" aria-hidden="true">{mi + 1}</span>
                <span>{nameOf(id)}</span>
                <span class="move-pair">
                  <button type="button" class="sm icon" aria-label={`Move ${nameOf(id)} up in ${label}`} disabled={mi === 0} onclick={() => change(gi, { proxies: move(g.proxies, mi, mi - 1) })}>↑</button>
                  <button type="button" class="sm icon" aria-label={`Move ${nameOf(id)} down in ${label}`} disabled={mi === g.proxies.length - 1} onclick={() => change(gi, { proxies: move(g.proxies, mi, mi + 1) })}>↓</button>
                </span>
                <button type="button" class="sm remove" aria-label={`Take ${nameOf(id)} out of ${label}`} onclick={() => change(gi, { proxies: g.proxies.filter((x) => x !== id) })}>Take out</button>
              </li>
            {/each}
          </ol>
          {#if addable.length > 0}
            <label class="visually-hidden" for={`group-add-${g.id}`}>{`Add a proxy to ${label}`}</label>
            <select
              id={`group-add-${g.id}`}
              onchange={(e) => {
                change(gi, { proxies: [...g.proxies, addable[e.currentTarget.selectedIndex - 1].id] });
                e.currentTarget.selectedIndex = 0;
              }}
            >
              <option>Add a proxy…</option>
              {#each addable as e (e.id)}<option>{proxyName(e)}</option>{/each}
            </select>
          {/if}
          {#if g.proxies.length < GROUP_MIN}
            <p class="field-error" role="alert">{`A group needs at least ${GROUP_MIN} proxies. To use one proxy, point the rule or the default route at it.`}</p>
          {/if}
          <span class="field-title" id={`group-strategy-${g.id}`}>Strategy</span>
          <div class="segmented" role="radiogroup" aria-labelledby={`group-strategy-${g.id}`}>
            {#each STRATEGIES as m (m.value)}
              <label class:on={g.strategy === m.value}><input type="radio" name={`group-strategy-${g.id}`} value={m.value} checked={g.strategy === m.value} onchange={() => change(gi, { strategy: m.value })} />{m.title}</label>
            {/each}
          </div>
          <p class="hint">{STRATEGIES.find((m) => m.value === g.strategy)!.text}</p>
          {#if g.strategy === 'round_robin'}
            <Duration id={`group-rotate-${g.id}`} label="Change proxy every" secs={g.rotate_secs} onchange={(v) => change(gi, { rotate_secs: v })} />
          {:else if g.strategy === 'chaos'}
            <div class="grid2 tight">
              <Duration id={`group-chaos-min-${g.id}`} label="Shortest time before a change" secs={g.chaos_min_secs} onchange={(v) => change(gi, { chaos_min_secs: v })} />
              <Duration id={`group-chaos-max-${g.id}`} label="Longest time before a change" secs={g.chaos_max_secs} onchange={(v) => change(gi, { chaos_max_secs: v })} />
            </div>
            <p class="hint">{`A random time in between, now ${shortDuration(g.chaos_min_secs)} to ${shortDuration(g.chaos_max_secs)}.`}</p>
          {/if}
          {#if g.strategy !== 'failover'}
            <p class="hint">Rotation needs two reachable proxies. With only one, it is suspended and that proxy keeps carrying traffic.</p>
          {/if}
          {#each s.lines as l (l.key)}
            <p class="strategy-state" role="status">{l.key === '' ? `Now: ${l.text}` : `${keyLabel(keys, l.key)}: ${l.text}`}</p>
          {/each}
          <div class="proxy-actions">
            <button type="button" class="sm remove" aria-label={`Remove group ${label}`} disabled={used.length > 0} title={used.length > 0 ? `Used by ${used.join(', ')}: change those first.` : undefined} onclick={() => remove(gi)}>Remove group</button>
          </div>
        </div>
      </li>
    {/each}
  </ol>
  <div class="test-row">
    <button type="button" onclick={create} disabled={proxies.list.length < GROUP_MIN || proxies.groups.length >= MAX_GROUPS}>New group</button>
    {#if proxies.list.length < GROUP_MIN}
      <span class="hint inline">A group needs at least two proxies in the list.</span>
    {:else if proxies.groups.length >= MAX_GROUPS}
      <span class="hint inline">{`${MAX_GROUPS} groups is the most.`}</span>
    {/if}
  </div>
</div>
