<script lang="ts">
  import { POLICIES, destination, destinations, directEnd, isLocalOrOverlay, liveNow, patternProblem, proxyName, resolve, rulesProblem, sameDestination, type Route } from '../lib/routes';
  import type { Destination, Fallback, KeyInfo, ProxyPool, Rule, NetworkSettings } from '../lib/schemas';
  import DestinationPicker from './DestinationPicker.svelte';
  import KeyChips from './KeyChips.svelte';
  import { invoiceKeys, labelList, toggled } from '../lib/keys';
  import { keyLabel } from '../lib/routeview';

  // One rule being made or changed. It only changes the form: nothing
  // reconnects until "Save changes".
  let {
    rule,
    index,
    keys,
    form,
    pool,
    dashboardRelays,
    onsave,
    oncancel,
  }: {
    rule: Rule;
    /** Its place in the list, or null for a new rule. */
    index: number | null;
    keys: KeyInfo[];
    /** The form as it is (relays, assignments, proxies, groups and the other rules). */
    form: Pick<NetworkSettings, 'relays' | 'relay_keys' | 'proxies'>;
    pool: ProxyPool | null;
    dashboardRelays: string[];
    onsave: (rule: Rule, position: number) => void;
    oncancel: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<Rule>(structuredClone($state.snapshot(rule)) as Rule);
  // svelte-ignore state_referenced_locally
  let mode = $state<'relays' | 'pattern'>(rule.match.length > 0 && rule.match.every((p) => p.includes('://')) ? 'relays' : 'pattern');
  // svelte-ignore state_referenced_locally
  let patterns = $state(rule.match.filter((p) => !p.includes('://')).join(' '));
  // svelte-ignore state_referenced_locally
  let position = $state(index ?? form.proxies.rules.length);
  let understood = $state(false);

  const ids = $derived(keys.map((k) => k.id));
  const invoiceIds = $derived(invoiceKeys(keys).map((k) => k.id));
  /** With three keys or more: all keys (saved as empty), every invoice key (saved as their list), or some. */
  // svelte-ignore state_referenced_locally
  let forKeys = $state<'all' | 'invoice' | 'some'>(
    rule.keys.length === 0 ? 'all' : rule.keys.length === invoiceKeys(keys).length && invoiceKeys(keys).every((k) => rule.keys.includes(k.id)) ? 'invoice' : 'some',
  );
  function pickKeys(which: 'all' | 'invoice' | 'some') {
    forKeys = which;
    if (which === 'all') draft.keys = [];
    else if (which === 'invoice') draft.keys = [...invoiceIds];
  }
  const others = $derived(form.proxies.rules.filter((_, i) => i !== index));
  const match = $derived(mode === 'pattern' ? patterns.split(/[\s,]+/).filter((p) => p !== '') : draft.match.filter((p) => p.includes('://')));
  /** Whether the destination is a proxy or a group: only then is there a fallback. */
  const viaProxy = $derived(typeof draft.to === 'object');
  const candidate = $derived<Rule>({ ...draft, match, fallback: viaProxy ? draft.fallback : 'offline' });
  /** Every place the rule can take, the last one just before the default route. */
  const positions = $derived([...others.map((_, i) => ({ value: i, label: String(i + 1) })), { value: others.length, label: `${others.length + 1}, last before the default route` }]);
  const nextRules = $derived([...others.slice(0, position), candidate, ...others.slice(position)]);
  const next = $derived({ ...form, proxies: { ...form.proxies, rules: nextRules } });

  const via = (r: Route) => (typeof r.via === 'object' ? proxyName(form.proxies.list.find((e) => e.id === (r.via as { proxy: string }).proxy) ?? { name: '', url: r.via.proxy }) : r.via === 'direct' ? 'Direct' : 'No connection');

  /** Relays whose route this rule would change; one line when every key changes the same way. */
  const changes = $derived.by(() => {
    const out: { key: string; relay: string; before: string; after: string }[] = [];
    for (const k of keys) {
      const { now, offline } = liveNow(pool, form.proxies, k);
      const before = resolve(form, k.id, ids, now, offline);
      const after = resolve(next, k.id, ids, now, offline);
      after.forEach((a, i) => {
        if (via(a) === via(before[i])) return;
        const same = out.find((o) => o.relay === a.relay && o.before === via(before[i]) && o.after === via(a));
        if (same !== undefined) same.key = '';
        else out.push({ key: k.label, relay: a.relay, before: via(before[i]), after: via(a) });
      });
    }
    return out;
  });
  /** Relays this rule would decide (for some key): it matches and no earlier rule does. */
  const matched = $derived([...new Set(keys.flatMap((k) => resolve(next, k.id, ids, () => null, null).filter((r) => r.rule === position).map((r) => r.relay)))]);
  const exposed = $derived(candidate.to === 'direct' ? matched.filter((r) => !isLocalOrOverlay(r)) : []);
  /** How the rule's relays could still end up connecting straight (through its fallback). */
  const straight = $derived(candidate.to === 'direct' ? '' : directEnd(candidate.to, candidate.fallback, form.proxies.offline, form.proxies));
  const problem = $derived.by(() => {
    if (match.length === 0) return mode === 'pattern' ? 'Type at least one pattern.' : 'Tick at least one relay.';
    const bad = match.map(patternProblem).find((p) => p !== '');
    if (bad !== undefined) return bad;
    return rulesProblem(next, keys, dashboardRelays).replace(new RegExp(`^Rule ${position + 1}\\b`), 'This rule');
  });
  const ready = $derived(problem === '' && (exposed.length === 0 || understood));

  /** Which fallback is chosen: stay offline, the offline policy, or another destination. */
  const fallbackKind = $derived(typeof draft.fallback === 'object' ? 'to' : draft.fallback);
  /** The destinations a fallback may take: not the rule's own, and not block (that is staying offline). */
  const fallbackOmit = $derived<Destination[]>([draft.to, 'block']);
  const policy = $derived(POLICIES.find((p) => p.value === form.proxies.offline)!);

  function pick(to: Destination) {
    draft.to = to;
    if (typeof draft.fallback === 'object' && sameDestination(draft.fallback.to, to)) draft.fallback = 'offline';
  }
  function pickFallback(kind: 'offline' | 'policy' | 'to') {
    if (kind !== 'to') draft.fallback = kind;
    else draft.fallback = { to: destinations(form.proxies).find((d) => !fallbackOmit.some((o) => sameDestination(o, d)))! } satisfies Fallback;
  }
  const toggleRelay = (url: string, on: boolean) => (draft.match = on ? [...draft.match, url] : draft.match.filter((m) => m !== url));
</script>

<section class="card rule-editor" aria-labelledby="rule-editor-title">
  <h3 id="rule-editor-title">{index === null ? 'New rule' : `Rule ${index + 1}`}</h3>
  <p class="hint">
    Relays matching {match.length === 0 ? '…' : match.join(', ')}, for {candidate.keys.length === 0 ? 'all keys' : candidate.keys.map((k) => keyLabel(keys, k)).join(', ')}, go to {destination(candidate.to, form.proxies).toLowerCase()}.
  </p>

  <div class="rule-grid">
    <div class="rule-fields">
      <fieldset class="rule-step">
        <legend>1. Which relays</legend>
        <div class="segmented" role="radiogroup" aria-label="Choose relays by">
          <label class:on={mode === 'relays'}><input type="radio" name="rule-mode" checked={mode === 'relays'} onchange={() => (mode = 'relays')} />Specific relays</label>
          <label class:on={mode === 'pattern'}><input type="radio" name="rule-mode" checked={mode === 'pattern'} onchange={() => (mode = 'pattern')} />A pattern</label>
        </div>
        {#if mode === 'pattern'}
          <label for="rule-pattern" class="hint">Pattern on the relay's host name; several, separated by spaces</label>
          <input id="rule-pattern" class="mono" placeholder="*.onion" bind:value={patterns} />
          <span class="hint"><span class="mono">*</span> stands for anything. Examples: <span class="mono">*.onion</span> · <span class="mono">relay*.contextvm.org</span> · <span class="mono">*.example.com:7777</span>. The scheme and path are ignored.</span>
        {:else}
          <div class="rule-relays">
            {#each form.relays as r (r)}
              <label class="check"><input type="checkbox" checked={draft.match.includes(r)} onchange={(e) => toggleRelay(r, e.currentTarget.checked)} /><span class="mono">{r}</span></label>
            {/each}
          </div>
        {/if}
      </fieldset>

      <fieldset class="rule-step">
        <legend>2. For which keys</legend>
        {#if keys.length > 2}
          <div class="rule-choices" role="radiogroup" aria-label="For which keys">
            <label class="rule-choice" class:on={forKeys === 'all'}><input type="radio" name="rule-keys" checked={forKeys === 'all'} onchange={() => pickKeys('all')} /><span>All keys<small>Saved as “all keys”: keys you add later follow it too.</small></span></label>
            <label class="rule-choice" class:on={forKeys === 'invoice'}><input type="radio" name="rule-keys" checked={forKeys === 'invoice'} onchange={() => pickKeys('invoice')} /><span>Every invoice key<small>{`${labelList(invoiceKeys(keys).map((k) => k.label))}. Not the administration key. A key you add later joins if it starts with the routes of one of them.`}</small></span></label>
            <label class="rule-choice" class:on={forKeys === 'some'}><input type="radio" name="rule-keys" checked={forKeys === 'some'} onchange={() => pickKeys('some')} /><span>Only some keys<small>Pick them below.</small></span></label>
          </div>
          {#if forKeys === 'some'}
            <KeyChips {keys} assigned={draft.keys} label="This rule" onchange={(id, on) => (draft.keys = toggled(draft.keys, id, on, ids))} />
          {/if}
        {:else}
          <KeyChips {keys} assigned={draft.keys} label="This rule" onchange={(id, on) => (draft.keys = toggled(draft.keys, id, on, ids))} />
        {/if}
        <span class="hint">A rule for one key lets the same relay take a different route per key.</span>
      </fieldset>

      <fieldset class="rule-step">
        <legend>3. Where they go</legend>
        <DestinationPicker name="rule-to" label="Where they go" proxies={form.proxies} value={draft.to} onpick={pick} />
      </fieldset>

      {#if viaProxy}
        <fieldset class="rule-step">
          <legend>{`4. If ${destination(draft.to, form.proxies)} has nothing reachable`}</legend>
          <div class="rule-choices" role="radiogroup" aria-label="If it has nothing reachable">
            <label class="rule-choice" class:on={fallbackKind === 'offline'}><input type="radio" name="rule-fallback" checked={fallbackKind === 'offline'} onchange={() => pickFallback('offline')} /><span>Stay offline<small>Never connect another way.</small></span></label>
            <label class="rule-choice" class:on={fallbackKind === 'policy'}><input type="radio" name="rule-fallback" checked={fallbackKind === 'policy'} onchange={() => pickFallback('policy')} /><span>Follow the offline policy<small>{`As the default route does. Now: ${policy.title}.`}</small></span></label>
            <label class="rule-choice" class:on={fallbackKind === 'to'}><input type="radio" name="rule-fallback" checked={fallbackKind === 'to'} onchange={() => pickFallback('to')} /><span>Another destination<small>If that has nothing reachable either, the offline policy decides.</small></span></label>
          </div>
          {#if typeof draft.fallback === 'object'}
            {@const f = draft.fallback}
            <DestinationPicker name="rule-fallback-to" label="Fall back to" proxies={form.proxies} value={f.to} omit={fallbackOmit} onpick={(d) => (draft.fallback = { to: d })} />
          {/if}
        </fieldset>
      {/if}

      <div class="rule-step">
        <label for="rule-position" class="field-title">Place in the order</label>
        <select id="rule-position" onchange={(e) => (position = e.currentTarget.selectedIndex)}>
          {#each positions as p (p.value)}
            <option selected={p.value === position}>{p.label}</option>
          {/each}
        </select>
        <label for="rule-name" class="field-title">Name (optional)</label>
        <input id="rule-name" maxlength="60" placeholder="Tor relays" bind:value={draft.name} />
      </div>
    </div>

    <aside class="rule-preview" aria-label="What this rule would change">
      <b>What this would change</b>
      <span>{`Matches ${matched.length} of ${form.relays.length} relays.`}</span>
      {#each changes as c (`${c.key} ${c.relay}`)}
        <div class="rule-change">
          <span class="mono">{c.relay}</span>
          <span class="hint">{`${c.key !== '' && keys.length > 1 ? `${c.key}: ` : ''}${c.before} → ${c.after}`}</span>
        </div>
      {:else}
        <span class="hint">No relay changes route.</span>
      {/each}
      {#if exposed.length > 0}
        <div class="map-alert warn">
          <b>This exposes your IP address</b>
          <span>{`${exposed.join(', ')} ${exposed.length === 1 ? 'is an internet relay' : 'are internet relays'}. Connected directly, ${exposed.length === 1 ? 'it sees' : 'they see'} this machine's address, and the privacy score drops.`}</span>
          <label class="check"><input type="checkbox" bind:checked={understood} /> I understand: {exposed.length === 1 ? 'this relay' : 'these relays'} will see my IP address.</label>
        </div>
      {/if}
      {#if straight !== ''}
        <p class="map-alert warn" role="status">{straight}</p>
      {/if}
      {#if problem !== ''}<p class="field-error" role="alert">{problem}</p>{/if}
      <div class="test-row">
        <button type="button" class="primary" disabled={!ready} onclick={() => onsave({ ...candidate, name: draft.name.trim() }, position)}>{index === null ? 'Add rule' : 'Update rule'}</button>
        <button type="button" onclick={oncancel}>Cancel</button>
      </div>
      <span class="hint">This changes the form only. Nothing reconnects until "Save changes", which still undoes itself if no relay connects.</span>
    </aside>
  </div>
</section>
