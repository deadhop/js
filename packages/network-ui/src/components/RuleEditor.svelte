<script lang="ts">
  import { destination, isLocalOrOverlay, patternProblem, proxyName, resolve, rulesProblem, type DefaultRoute, type Route } from '../lib/routes';
  import type { KeyInfo, ProxyPool, ProxySettings, Rule, NetworkSettings } from '../lib/schemas';
  import KeyChips from './KeyChips.svelte';
  import { toggled } from '../lib/keys';
  import { keyLabel } from '../lib/routeview';

  // One rule being made or changed. It only changes the form: nothing
  // reconnects until "Save changes".
  let {
    rule,
    index,
    keys,
    form,
    saved,
    pool,
    dashboardRelays,
    onsave,
    oncancel,
  }: {
    rule: Rule;
    /** Its place in the list, or null for a new rule. */
    index: number | null;
    keys: KeyInfo[];
    /** The form as it is (relays, assignments, proxies and the other rules). */
    form: Pick<NetworkSettings, 'relays' | 'relay_keys' | 'proxies'>;
    /** The saved proxies: a rule can only go through one of these. */
    saved: ProxySettings['list'];
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
  const others = $derived(form.proxies.rules.filter((_, i) => i !== index));
  const match = $derived(mode === 'pattern' ? patterns.split(/[\s,]+/).filter((p) => p !== '') : draft.match.filter((p) => p.includes('://')));
  const candidate = $derived<Rule>({ ...draft, match, fallback: typeof draft.to === 'object' ? draft.fallback : 'offline' });
  /** Every place the rule can take, the last one just before the default route. */
  const positions = $derived([...others.map((_, i) => ({ value: i, label: String(i + 1) })), { value: others.length, label: `${others.length + 1}, last before the default route` }]);
  const nextRules = $derived([...others.slice(0, position), candidate, ...others.slice(position)]);
  const next = $derived({ ...form, proxies: { ...form.proxies, rules: nextRules } });

  /** Each key's default route now, as the service reports it. */
  const defaultOf = (key: string): DefaultRoute => {
    const lane = pool?.lanes.find((l) => l.key === key);
    if (lane === undefined) return 'off';
    if (lane.active !== null) return { proxy: lane.active };
    return lane.state === 'direct' || lane.state === 'transparent' ? 'direct' : 'off';
  };
  const up = (id: string) => pool?.proxies.find((p) => p.id === id)?.reachable !== false;
  const via = (r: Route) => (typeof r.via === 'object' ? proxyName(form.proxies.list.find((e) => e.id === (r.via as { proxy: string }).proxy) ?? { name: '', url: r.via.proxy }) : r.via === 'direct' ? 'Direct' : 'No connection');

  /** Relays whose route this rule would change; one line when every key changes the same way. */
  const changes = $derived.by(() => {
    const out: { key: string; relay: string; before: string; after: string }[] = [];
    for (const k of keys) {
      const before = resolve(form, k.id, ids, defaultOf(k.id), up);
      const after = resolve(next, k.id, ids, defaultOf(k.id), up);
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
  const matched = $derived([...new Set(keys.flatMap((k) => resolve(next, k.id, ids, 'off', () => true).filter((r) => r.rule === position).map((r) => r.relay)))]);
  const exposed = $derived(candidate.to === 'direct' ? matched.filter((r) => !isLocalOrOverlay(r)) : []);
  const problem = $derived.by(() => {
    if (match.length === 0) return mode === 'pattern' ? 'Type at least one pattern.' : 'Tick at least one relay.';
    const bad = match.map(patternProblem).find((p) => p !== '');
    if (bad !== undefined) return bad;
    return rulesProblem(next, keys, saved, dashboardRelays).replace(`Rule ${position + 1}`, 'This rule');
  });
  const ready = $derived(problem === '' && (exposed.length === 0 || understood));

  const isProxy = (id: string) => typeof draft.to === 'object' && draft.to.proxy === id;
  const pick = (to: Rule['to']) => (draft.to = to);
  const toggleRelay = (url: string, on: boolean) => (draft.match = on ? [...draft.match, url] : draft.match.filter((m) => m !== url));
</script>

<section class="card rule-editor" aria-labelledby="rule-editor-title">
  <h3 id="rule-editor-title">{index === null ? 'New rule' : `Rule ${index + 1}`}</h3>
  <p class="hint">
    Relays matching {match.length === 0 ? '…' : match.join(', ')}, for {candidate.keys.length === 0 ? 'all keys' : candidate.keys.map((k) => keyLabel(keys, k)).join(', ')}, go to {destination(candidate.to, form.proxies.list).toLowerCase()}.
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
        <KeyChips {keys} assigned={draft.keys} label="This rule" onchange={(id, on) => (draft.keys = toggled(draft.keys, id, on, ids))} />
        <span class="hint">A rule for one key lets the same relay take a different route per key.</span>
      </fieldset>

      <fieldset class="rule-step">
        <legend>3. Where they go</legend>
        <div class="rule-choices" role="radiogroup" aria-label="Where they go">
          {#each saved as e (e.id)}
            <label class="rule-choice" class:on={isProxy(e.id)}><input type="radio" name="rule-to" checked={isProxy(e.id)} onchange={() => pick({ proxy: e.id })} /><span>Through {proxyName(e)}</span></label>
          {/each}
          <label class="rule-choice" class:on={draft.to === 'pool'}><input type="radio" name="rule-to" checked={draft.to === 'pool'} onchange={() => pick('pool')} /><span>The default route<small>The pool and its strategy. Useful to exempt relays from a broader rule below.</small></span></label>
          <label class="rule-choice" class:on={draft.to === 'direct'}><input type="radio" name="rule-to" checked={draft.to === 'direct'} onchange={() => pick('direct')} /><span>Direct, no proxy<small>For relays on this network, or on FIPS.</small></span></label>
          <label class="rule-choice" class:on={draft.to === 'block'}><input type="radio" name="rule-to" checked={draft.to === 'block'} onchange={() => pick('block')} /><span>Nowhere: block<small>Never connect to these relays, even if they are listed.</small></span></label>
        </div>
        {#if form.proxies.list.length > saved.length}<span class="hint">A proxy that is not saved yet can be chosen once it is saved.</span>{/if}
      </fieldset>

      {#if typeof draft.to === 'object'}
        <fieldset class="rule-step">
          <legend>4. If that proxy is down</legend>
          <div class="rule-choices" role="radiogroup" aria-label="If that proxy is down">
            <label class="rule-choice" class:on={draft.fallback === 'offline'}><input type="radio" name="rule-fallback" checked={draft.fallback === 'offline'} onchange={() => (draft.fallback = 'offline')} /><span>Stay offline<small>Never connect another way.</small></span></label>
            <label class="rule-choice" class:on={draft.fallback === 'pool'}><input type="radio" name="rule-fallback" checked={draft.fallback === 'pool'} onchange={() => (draft.fallback = 'pool')} /><span>Use the default route<small>Until the proxy is back.</small></span></label>
          </div>
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
      {#if problem !== ''}<p class="field-error" role="alert">{problem}</p>{/if}
      <div class="test-row">
        <button type="button" class="primary" disabled={!ready} onclick={() => onsave({ ...candidate, name: draft.name.trim() }, position)}>{index === null ? 'Add rule' : 'Update rule'}</button>
        <button type="button" onclick={oncancel}>Cancel</button>
      </div>
      <span class="hint">This changes the form only. Nothing reconnects until "Save changes", which still undoes itself if no relay connects.</span>
    </aside>
  </div>
</section>
