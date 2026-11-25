<script lang="ts">
  import { move } from '../lib/proxy';
  import { MAX_RULES, POLICIES, destination, fallbackText, firstRule, newRule } from '../lib/routes';
  import { keyLabel } from '../lib/routeview';
  import type { Destination, KeyInfo, ProxyPool, Rule, NetworkSettings } from '../lib/schemas';
  import DefaultRoute from './DefaultRoute.svelte';
  import RuleEditor from './RuleEditor.svelte';

  // The ordered rule list. Changes go into the form (`form.proxies.rules`);
  // the save bar sends them.
  let {
    keys,
    form,
    pool,
    dashboardRelays,
    locked,
    onproxies,
  }: {
    keys: KeyInfo[];
    form: Pick<NetworkSettings, 'relays' | 'relay_keys' | 'proxies'>;
    pool: ProxyPool | null;
    dashboardRelays: string[];
    /** DEADHOP_PROXY_LOCKED: rules are part of the proxy settings. */
    locked: boolean;
    /** Open the Proxies view (where the offline policy is). */
    onproxies: () => void;
  } = $props();

  let editing = $state<{ index: number | null; rule: Rule } | null>(null);
  /** The default route's editor is open. */
  let editingDefault = $state(false);

  const rules = $derived(form.proxies.rules);
  const relaysOf = (i: number) => form.relays.filter((relay) => keys.some((k) => firstRule(rules, k.id, relay) === i));
  /** The relays a rule matches, for its keys, whether or not an earlier rule takes them first. */
  const matchingOf = (r: Rule) => form.relays.filter((relay) => keys.some((k) => (r.keys.length === 0 || r.keys.includes(k.id)) && firstRule([r], k.id, relay) === 0));
  /** The earlier rule that takes every relay this one matches, if any. */
  const hiddenBy = (i: number) => {
    const matching = matchingOf(rules[i]);
    if (matching.length === 0 || relaysOf(i).length > 0) return null;
    return firstRule(rules, keys.find((k) => rules[i].keys.length === 0 || rules[i].keys.includes(k.id))!.id, matching[0]) + 1;
  };
  /** The pill colour of a destination: its proxy's, the group colour, direct or block. */
  const color = (d: Destination) => (typeof d !== 'object' ? d : 'group' in d ? 'pool' : `proxy-c${form.proxies.list.findIndex((e) => e.id === d.proxy) % 8}`);
  const keysText = (r: Rule) => (r.keys.length === 0 ? 'All keys' : r.keys.map((k) => keyLabel(keys, k)).join(', '));

  function reorder(from: number, to: number) {
    form.proxies.rules = move(form.proxies.rules, from, to);
  }

  function gripKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    reorder(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
  }

  function remove(i: number) {
    form.proxies.rules = form.proxies.rules.filter((_, j) => j !== i);
  }

  function put(rule: Rule, position: number) {
    const others = form.proxies.rules.filter((_, i) => i !== editing!.index);
    form.proxies.rules = [...others.slice(0, position), rule, ...others.slice(position)];
    editing = null;
  }

  const policy = $derived(POLICIES.find((p) => p.value === form.proxies.offline)!);
  /** The keys with a default route of their own. */
  const ownDefaults = $derived(keys.filter((k) => form.proxies.default_keys[k.id] !== undefined));
  const defaultRelays = $derived(form.relays.filter((relay) => keys.some((k) => firstRule(rules, k.id, relay) < 0)));
</script>

<section class="card rules" aria-labelledby="s-rules">
  <div class="card-head">
    <h2 id="s-rules">Rules</h2>
    <span class="badge detected">{`${rules.length} of ${MAX_RULES}`}</span>
    <button type="button" class="primary rules-new" disabled={locked || rules.length >= MAX_RULES || editing !== null} onclick={() => (editing = { index: null, rule: newRule(form.proxies) })}>New rule</button>
  </div>
  <p class="hint">
    Rules are checked from the top. The first one that matches a relay decides its route, so put narrow rules above broad ones. A relay that matches none goes by the default
    route, the last row: change it there.
  </p>
  {#if locked}<p class="note" role="status">Locked on the host (DEADHOP_PROXY_LOCKED). Rules can only be changed there.</p>{/if}

  {#if editing !== null}
    <RuleEditor rule={editing.rule} index={editing.index} {keys} {form} {pool} {dashboardRelays} onsave={put} oncancel={() => (editing = null)} />
  {/if}
  {#if editingDefault}
    <DefaultRoute {keys} proxies={form.proxies} ondone={() => (editingDefault = false)} {onproxies} />
  {/if}

  <ol class="rule-list" aria-label="Rules, in order">
    {#each rules as r, i (i)}
      {@const now = relaysOf(i)}
      {@const hidden = hiddenBy(i)}
      <li class="rule-row">
        <button type="button" class="grip" aria-label={`Reorder rule ${i + 1} with the arrow keys`} disabled={locked} onkeydown={(e) => gripKey(e, i)}>
          <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
            {#each [2, 8, 14] as y (y)}<circle cx="2" cy={y} r="1.5" /><circle cx="8" cy={y} r="1.5" />{/each}
          </svg>
        </button>
        <span class="rule-no">{i + 1}</span>
        <span class="rule-match">
          <span class="mono">{r.match.join(' ')}</span>
          <span class="hint">{r.name !== '' ? r.name : r.match.every((m) => m.includes('://')) ? `${r.match.length === 1 ? 'This relay' : `These ${r.match.length} relays`}, by address` : 'Pattern on the host name'}</span>
        </span>
        <span class="rule-meta">
          <span class={`via-pill ${color(r.to)}`}><span class="via-dot"></span>{destination(r.to, form.proxies)}</span>
          <span class="rule-keys">{keysText(r)}</span>
          {#if typeof r.to === 'object'}<span class={`rule-down ${r.fallback === 'offline' ? 'bad' : ''}`}>{fallbackText(r.fallback, form.proxies)}</span>{/if}
          <span class="rule-now">
            {#if hidden !== null}
              <span class="warn">{`Hidden by rule ${hidden}: never used`}</span>
            {:else if now.length === 0}
              <span class="muted">No relay yet</span>
            {:else}
              <span>{now.length === 1 ? `Now: 1 relay, ${now[0]}` : `Now: ${now.length} relays`}</span>
            {/if}
          </span>
        </span>
        <span class="rule-actions">
          <button type="button" class="sm icon" aria-label={`Move rule ${i + 1} up`} disabled={locked || i === 0} onclick={() => reorder(i, i - 1)}>↑</button>
          <button type="button" class="sm icon" aria-label={`Move rule ${i + 1} down`} disabled={locked || i === rules.length - 1} onclick={() => reorder(i, i + 1)}>↓</button>
          <button type="button" class="sm" aria-label={`Edit rule ${i + 1}`} disabled={locked || editing !== null} onclick={() => (editing = { index: i, rule: r })}>Edit</button>
          <button type="button" class="sm remove" aria-label={`Remove rule ${i + 1}`} disabled={locked} onclick={() => remove(i)}>Remove</button>
        </span>
      </li>
    {/each}
    <li class="rule-row default">
      <span class="grip-space" aria-hidden="true"></span>
      <span class="rule-no">·</span>
      <span class="rule-match"><b>Everything else</b><span class="hint">Default route. Always last.</span></span>
      <span class="rule-meta">
        <span class={`via-pill ${color(form.proxies.default)}`}><span class="via-dot"></span>{destination(form.proxies.default, form.proxies)}</span>
        <span class="rule-keys">{ownDefaults.length === 0 ? 'All keys' : 'Every other key'}</span>
        {#if typeof form.proxies.default === 'object'}<span class="rule-down">{`If down: the offline policy (${policy.title})`}</span>{/if}
        <span class="rule-now">{defaultRelays.length === 1 ? `Now: 1 relay, ${defaultRelays[0]}` : `Now: ${defaultRelays.length} relays`}</span>
        {#each ownDefaults as k (k.id)}
          {@const own = form.proxies.default_keys[k.id]}
          <span class="rule-keys">{`For the ${k.label} key:`}</span>
          <span class={`via-pill ${color(own)}`}><span class="via-dot"></span>{destination(own, form.proxies)}</span>
        {/each}
      </span>
      <span class="rule-actions"><button type="button" class="sm" aria-label="Edit the default route" disabled={locked || editingDefault} onclick={() => (editingDefault = true)}>Edit</button></span>
    </li>
  </ol>
</section>
