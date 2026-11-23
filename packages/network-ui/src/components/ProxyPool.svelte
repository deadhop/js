<script lang="ts">
  import type { NetworkApi } from '../lib/network-api';
  import { formatDuration } from '../lib/format';
  import { keyTag, toggled, usersOf } from '../lib/keys';
  import {
    I2P_PORT,
    MAX_PROXIES,
    buildProxy,
    editedUrl,
    i2pProxy,
    i2pRule,
    i2pRuleIndex,
    isNew,
    move,
    newEntry,
    parseProxy,
    poolOf,
    shortDuration,
    type ProxyFields,
    type ProxyKind,
  } from '../lib/proxy';
  import { destination, proxyName } from '../lib/routes';
  import type { KeyInfo, OfflinePolicy, ProxyCheck, ProxyMode, ProxyPool, ProxySettings } from '../lib/schemas';
  import Duration from './Duration.svelte';
  import KeyChips from './KeyChips.svelte';
  import ProxyStatus from './ProxyStatus.svelte';

  let {
    api,
    keys,
    proxies,
    live,
    pool,
    locked,
    registriesAt = 'under Settings',
  }: {
    api: NetworkApi;
    /** The service's keys, for choosing which may use each proxy. */
    keys: KeyInfo[];
    /** The form's proxy settings (changed in place). */
    proxies: ProxySettings;
    /** The saved ones, to tell which entries are unchanged. */
    live: ProxySettings;
    /** What the service says about them now. */
    pool: ProxyPool | null;
    /** DEADHOP_PROXY_LOCKED. */
    locked: boolean;
    /** Where the page keeps the I2P name registries, as words that end the sentence "… are looked up is …". */
    registriesAt?: string;
  } = $props();

  const MODES: { value: ProxyMode; title: string; text: string }[] = [
    { value: 'off', title: 'Off', text: 'Use the first proxy in the list and never switch. While it is down, the policy below applies, even if other proxies are up.' },
    { value: 'failover', title: 'Failover', text: 'Use the first proxy in the list. If it is down, use the next one.' },
    { value: 'round_robin', title: 'Round-robin', text: 'Go around the list, one change at a set interval (not per connection).' },
    { value: 'chaos', title: 'Chaos', text: 'Switch to a random other proxy after a random time between a shortest and a longest interval.' },
  ];
  const POLICIES: { value: OfflinePolicy; title: string; text: string; clearnet: boolean }[] = [
    { value: 'kill_switch', title: 'Kill switch', text: 'Disconnect from every relay. The service is off until a proxy is back.', clearnet: false },
    { value: 'admin_only', title: 'Operators only', text: 'Connect straight, but answer operators only, so the proxies can be repaired (unless they are locked on the host).', clearnet: true },
    { value: 'invoicing_only', title: 'Invoicing only', text: 'Connect straight and keep invoicing on. Operators are not served, so nothing can be managed.', clearnet: true },
    { value: 'open', title: 'Carry on', text: 'Connect straight and serve everyone as usual.', clearnet: true },
  ];

  const full = $derived(proxies.list.length >= MAX_PROXIES);

  /** With the strategy off, the default-route proxies that are first for no key: never used. */
  const unused = $derived.by((): Set<string> => {
    if (proxies.mode !== 'off') return new Set();
    const ids = keys.map((k) => k.id);
    const route = poolOf(proxies);
    const used = new Set(ids.flatMap((k) => route.filter((p) => usersOf(p.keys, ids).includes(k)).slice(0, 1).map((p) => p.id)));
    return new Set(route.filter((p) => !used.has(p.id)).map((p) => p.id));
  });

  // ---- the list ----
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<number | null>(null);

  function moveTo(from: number, to: number) {
    proxies.list = move(proxies.list, from, to);
  }

  function endDrag() {
    dragFrom = null;
    dragOver = null;
  }

  function drop(to: number) {
    if (dragFrom !== null) moveTo(dragFrom, to);
    endDrag();
  }

  function gripKey(e: KeyboardEvent, i: number) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    moveTo(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
  }

  function inPool(i: number, on: boolean) {
    proxies.list = proxies.list.map((e, j) => (j === i ? { ...e, pool: on } : e));
  }

  /** What a proxy carries now and which rules point at it. */
  function carrying(id: string): string {
    const relays = [...new Set((pool?.routes ?? []).filter((r) => r.proxy === id).map((r) => r.relay))];
    const rules = proxies.rules.flatMap((r, i) => (typeof r.to === 'object' && r.to.proxy === id ? [i + 1] : []));
    const carries = `Carries ${relays.length === 1 ? '1 relay' : `${relays.length} relays`} now`;
    return rules.length === 0 ? carries : `${carries} · rule${rules.length === 1 ? '' : 's'} ${rules.join(', ')} point${rules.length === 1 ? 's' : ''} here`;
  }

  function useProxy(i: number, id: string, on: boolean) {
    proxies.list = proxies.list.map((e, j) => (j === i ? { ...e, keys: toggled(e.keys, id, on, keys.map((k) => k.id)) } : e));
  }

  function statusOf(id: string) {
    return pool?.proxies.find((p) => p.id === id) ?? null;
  }

  // ---- create and edit ----
  let draft = $state<{ index: number | null; name: string; fields: ProxyFields } | null>(null);
  let draftError = $state('');

  function create() {
    draft = { index: null, name: '', fields: { ...parseProxy(''), kind: 'socks5', host: '127.0.0.1', port: '9050' } };
    draftError = '';
  }

  function edit(i: number) {
    const e = proxies.list[i];
    draft = { index: i, name: e.name, fields: parseProxy(e.url, e.i2p === true) };
    draftError = '';
  }

  function commit() {
    const d = draft!;
    const built = d.index === null ? buildProxy(d.fields) : editedUrl(proxies.list[d.index].url, d.fields);
    if ('error' in built) {
      draftError = built.error;
      return;
    }
    if (proxies.list.some((e, i) => i !== d.index && e.url === built.url)) {
      draftError = 'That proxy is already listed.';
      return;
    }
    const name = d.name.trim();
    const i2p = d.fields.kind === 'i2p';
    if (d.index === null) proxies.list = [...proxies.list, newEntry(name, built.url, i2p)];
    else proxies.list = proxies.list.map((e, i) => (i === d.index ? { ...e, name, url: built.url, i2p } : e));
    draft = null;
  }

  /** Another proxy is already the I2P router: only one can be. */
  const otherI2p = $derived(draft !== null && proxies.list.some((e, i) => e.i2p === true && i !== draft!.index));

  /** Picking the I2P router fills in its usual port. */
  function pickKind(kind: ProxyKind) {
    const f = draft!.fields;
    f.kind = kind;
    if (kind === 'i2p' && (f.port === '' || f.port === '9050')) f.port = I2P_PORT;
  }

  // ---- I2P names ----
  const router = $derived(i2pProxy(proxies));
  const i2pRuleAt = $derived(i2pRuleIndex(proxies.rules));
  function routeI2p(id: string) {
    proxies.rules = [...proxies.rules, i2pRule(id)];
  }

  function remove(i: number) {
    proxies.list = proxies.list.filter((_, j) => j !== i);
    draft = null;
  }

  // ---- testing ----
  let tests = $state<Record<string, { check: ProxyCheck | null; checking: boolean; error: string }>>({});

  async function test(i: number) {
    const e = proxies.list[i];
    const saved = live.list.find((l) => l.id === e.id);
    // A saved, unchanged proxy is tested by id (its real password is on the service).
    const target = saved && saved.url === e.url ? { id: e.id } : e.url;
    tests[e.id] = { check: null, checking: true, error: '' };
    try {
      tests[e.id] = { check: await api.checkProxy(target), checking: false, error: '' };
    } catch (err) {
      tests[e.id] = { check: null, checking: false, error: (err as Error).message };
    }
  }

  // ---- what the service is doing ----
  /** One line per key when the keys do not all use the same proxies. */
  const lanes = $derived.by((): string[] => {
    if (pool === null || !proxies.list.some((p) => p.keys.length > 0)) return [];
    // With the strategy off nothing switches: only a key that lost its first proxy is news.
    return pool.lanes.filter((l) => pool!.mode !== 'off' || l.state === 'offline').map((l) => {
      const label = keys.find((k) => k.id === l.key)?.label ?? keyTag(l.key);
      const proxy = pool!.proxies.find((p) => p.id === l.active);
      const using = proxy ? `using ${proxy.name === '' ? proxy.url : proxy.name}` : l.state === 'offline' ? (pool!.mode === 'off' ? 'its first proxy is down' : 'no proxy reachable') : l.state;
      return `${label}: ${using}`;
    });
  });
  const stateLine = $derived.by((): string => {
    if (pool === null) return '';
    const position = pool.active === null ? -1 : pool.proxies.findIndex((p) => p.id === pool.active);
    const policy = POLICIES.find((p) => p.value === pool.offline)!.title.toLowerCase();
    switch (pool.state) {
      case 'transparent':
        return 'Transparent proxy declared: nothing is checked.';
      case 'direct':
        return 'No proxy is listed: relays connect straight.';
      case 'active': {
        if (pool.mode === 'off') return '';
        const next = pool.next_switch_at === null ? '' : ` · next switch in ${formatDuration(Math.max(0, pool.next_switch_at - Math.floor(Date.now() / 1000)))}`;
        return `Active · proxy ${position + 1} of ${pool.total}${next}`;
      }
      case 'suspended':
        return `Suspended: rotation needs 2 reachable proxies, ${pool.reachable} is. That proxy keeps carrying traffic.`;
      default:
        return pool.mode === 'off' && pool.reachable > 0 ? `Offline: the first proxy is down and the strategy is off · ${policy}` : `Offline: no proxy is reachable · ${policy}`;
    }
  });
</script>

<section class="card proxy-pool" aria-labelledby="s-proxy">
  <div class="card-head">
    <h2 id="s-proxy">Proxies</h2>
    <span class="badge detected">{`${proxies.list.length} of ${MAX_PROXIES}`}</span>
  </div>
  <p class="hint">
    Only relay traffic uses a proxy; the Electrum server is always reached directly. SOCKS5 resolves names at the proxy, so <span class="mono">.onion</span> relays
    work through Tor. A key that can change these settings can learn this service's IP address: set <span class="mono">DEADHOP_PROXY_LOCKED=true</span> on the host
    to make them host-only.
  </p>
  {#if locked}
    <p class="note" role="status">Locked on the host (DEADHOP_PROXY_LOCKED). These settings can only be changed there.</p>
  {/if}

  <label class="check transparent-toggle">
    <input type="checkbox" bind:checked={proxies.transparent} disabled={locked} />
    <span>
      <strong>I run a transparent proxy around this service</strong>
      <span class="hint">Nothing here is checked or used: no proxy is probed, and privacy warnings about the proxy are not raised.</span>
    </span>
  </label>
  {#if proxies.transparent}
    <p class="note" role="status">Transparent proxy declared. The service trusts it and checks nothing. Your proxy list and settings are kept for when you turn this off.</p>
  {:else}
    <fieldset class="pool-body" class:greyed={locked} disabled={locked}>
      <legend class="field-title">Proxy list, in order</legend>
      {#if proxies.list.length === 0}
        <p class="muted">No proxies. Relays connect straight to this machine.</p>
      {/if}
      <ol class="proxy-list">
        {#each proxies.list as entry, i (entry.id)}
          {@const st = statusOf(entry.id)}
          {@const t = tests[entry.id]}
          <li
            class="proxy-row"
            class:dragging={dragFrom === i}
            class:drop-target={dragFrom !== null && dragOver === i && dragFrom !== i}
            ondragover={(e) => {
              e.preventDefault();
              dragOver = i;
            }}
            ondrop={(e) => {
              e.preventDefault();
              drop(i);
            }}
          >
            {#if proxies.list.length > 1}
              <button
                type="button"
                class="grip"
                draggable="true"
                aria-label={`Drag to reorder proxy ${i + 1}`}
                title="Drag to reorder (or use the arrow keys)"
                ondragstart={(e) => {
                  dragFrom = i;
                  e.dataTransfer?.setData('text/plain', String(i));
                }}
                ondragend={endDrag}
                onkeydown={(e) => gripKey(e, i)}
              >
                <svg viewBox="0 0 10 16" width="10" height="16" aria-hidden="true">
                  {#each [2, 8, 14] as y (y)}<circle cx="2" cy={y} r="1.5" /><circle cx="8" cy={y} r="1.5" />{/each}
                </svg>
              </button>
            {/if}
            <span class="pos mono" aria-hidden="true">{i + 1}</span>
            <span class="proxy-id">
              <span class="proxy-name">{entry.name === '' ? 'Unnamed proxy' : entry.name}{#if entry.i2p}<span class="badge i2p-badge">I2P router</span>{/if}</span>
              <code class="mono">{entry.url}</code>
            </span>
            <span class="proxy-state">
              {#if pool?.active === entry.id}<span class="badge confirmed">in use</span>{/if}
              {#if isNew(entry)}
                <span class="badge not_checked">not saved</span>
              {:else if st === null || st.reachable === null}
                <span class="badge not_checked">not checked</span>
              {:else if st.reachable}
                <span class="badge pass">reachable</span>
              {:else}
                <span class="badge fail" title={st.reason ?? ''}>unreachable</span>
              {/if}
            </span>
            <div class="proxy-routes">
              <label class="check pool-toggle"><input type="checkbox" checked={entry.pool} aria-label={`Proxy ${i + 1} in the default route`} onchange={(e) => inPool(i, e.currentTarget.checked)} /> In the default route</label>
              {#if !entry.pool}<span class="badge not_checked">rules only</span>{:else if unused.has(entry.id)}<span class="badge not_checked">not used: strategy off</span>{/if}
              <span class="hint">{carrying(entry.id)}</span>
            </div>
            <div class="proxy-foot">
              {#if entry.pool}<KeyChips {keys} assigned={entry.keys} label={`Proxy ${i + 1}`} onchange={(id, on) => useProxy(i, id, on)} />{:else}<span class="hint">Used only by rules that name it.</span>{/if}
              <span class="proxy-actions">
                {#if proxies.list.length > 1}
                  <span class="move-pair">
                    <button type="button" class="sm icon" aria-label={`Move proxy ${i + 1} up`} disabled={i === 0} onclick={() => moveTo(i, i - 1)}>↑</button>
                    <button type="button" class="sm icon" aria-label={`Move proxy ${i + 1} down`} disabled={i === proxies.list.length - 1} onclick={() => moveTo(i, i + 1)}>↓</button>
                  </span>
                {/if}
                <button type="button" class="sm" aria-label={`Test proxy ${i + 1}`} disabled={t?.checking === true} onclick={() => void test(i)}>{t?.checking ? 'Testing…' : 'Test'}</button>
                <button type="button" class="sm" aria-label={`Edit proxy ${i + 1}`} onclick={() => edit(i)}>Edit</button>
                <button type="button" class="sm remove" aria-label={`Remove proxy ${i + 1}`} onclick={() => remove(i)}>Remove</button>
              </span>
            </div>
            {#if st !== null && st.reachable === false && st.reason !== null}<p class="proxy-reason">{st.reason}</p>{/if}
            {#if t}<div class="proxy-test"><ProxyStatus check={t.check} checking={t.checking} error={t.error} /></div>{/if}
          </li>
        {/each}
      </ol>

      {#if draft}
        <div class="proxy-form" role="group" aria-label={draft.index === null ? 'Create proxy' : `Edit proxy ${draft.index + 1}`}>
          <div class="grid2 tight">
            <div class="field"><label for="proxy-label">Label (optional)</label><input id="proxy-label" bind:value={draft.name} maxlength="60" placeholder="Tor" /></div>
            <div class="field">
              <label for="proxy-kind">Type</label>
              <select id="proxy-kind" bind:value={() => draft!.fields.kind, pickKind}>
                <option value="socks5">SOCKS5 (Tor, VPN)</option>
                <option value="https">HTTPS proxy</option>
                <option value="http">HTTP proxy</option>
                <option value="i2p" disabled={otherI2p}>I2P router</option>
              </select>
              {#if otherI2p}
                <p class="hint">An I2P router is already listed. Only one can be.</p>
              {:else if draft.fields.kind === 'i2p'}
                <p class="hint">Your I2P router's HTTP proxy, usually port 4444. I2P names are looked up through it. It starts outside the default route.</p>
              {/if}
            </div>
            <div class="field"><label for="proxy-host">Host</label><input id="proxy-host" class="mono" bind:value={draft.fields.host} placeholder="127.0.0.1" /></div>
            <div class="field"><label for="proxy-port">Port</label><input id="proxy-port" class="mono" bind:value={draft.fields.port} inputmode="numeric" placeholder="9050" /></div>
            <div class="field"><label for="proxy-user">User name</label><input id="proxy-user" bind:value={draft.fields.username} autocomplete="off" /></div>
            <div class="field">
              <label for="proxy-pass">Password</label>
              <input id="proxy-pass" type="password" bind:value={draft.fields.password} autocomplete="new-password" placeholder={draft.fields.hasPassword ? 'unchanged' : ''} />
            </div>
          </div>
          {#if draftError}<p class="error" role="alert">{draftError}</p>{/if}
          <div class="test-row">
            <button type="button" class="primary" onclick={commit}>{draft.index === null ? 'Add to list' : 'Update proxy'}</button>
            <button type="button" onclick={() => (draft = null)}>Cancel</button>
          </div>
        </div>
      {:else}
        <div class="test-row">
          <button type="button" onclick={create} disabled={full}>Create proxy</button>
          {#if full}<span class="hint inline">Eight proxies is the most.</span>{/if}
        </div>
      {/if}

      {#if router}
        <div class="i2p-names" role="group" aria-labelledby="i2p-title">
          <span class="field-title" id="i2p-title">I2P relays</span>
          <p class="hint">{`${proxyName(router)} carries relays only when a rule sends them to it. Where .i2p names are looked up is ${registriesAt}.`}</p>
          {#if i2pRuleAt >= 0}
            <p class="hint">{`Rule ${i2pRuleAt + 1} decides where .i2p relays go: ${destination(proxies.rules[i2pRuleAt].to, proxies.list).toLowerCase()}.`}</p>
          {:else if isNew(router)}
            <p class="hint">Save this proxy first. Then it can carry your .i2p relays.</p>
          {:else}
            <div class="test-row">
              <button type="button" onclick={() => routeI2p(router!.id)} disabled={proxies.rules.length >= 16}>Send .i2p relays through this proxy</button>
              <span class="hint inline">Adds a rule. Until then .i2p relays take the default route.</span>
            </div>
          {/if}
        </div>
      {/if}

      <div class="field strategy">
        <span class="field-title">Default route</span>
        <p class="hint">{poolOf(proxies).length === 0 && proxies.list.length > 0 ? 'Every relay that no rule in Rules names goes through the proxies ticked “In the default route” above. None is ticked, so those relays stay offline.' : 'Every relay that no rule in Rules names goes through the proxies ticked “In the default route” above.'}</p>
        {#if poolOf(proxies).length > 1}
          <span class="field-title" id="strategy-title">Strategy</span>
          <div class="segmented" role="radiogroup" aria-labelledby="strategy-title">
            {#each MODES as m (m.value)}
              <label class:on={proxies.mode === m.value}><input type="radio" name="proxy-mode" value={m.value} checked={proxies.mode === m.value} onchange={() => (proxies.mode = m.value)} />{m.title}</label>
            {/each}
          </div>
          <p class="hint">{MODES.find((m) => m.value === proxies.mode)!.text}</p>
          {#if proxies.mode === 'round_robin'}
            <Duration id="rotate" label="Change proxy every" secs={proxies.rotate_secs} onchange={(v) => (proxies.rotate_secs = v)} />
          {:else if proxies.mode === 'chaos'}
            <div class="grid2 tight">
              <Duration id="chaos-min" label="Shortest time before a change" secs={proxies.chaos_min_secs} onchange={(v) => (proxies.chaos_min_secs = v)} />
              <Duration id="chaos-max" label="Longest time before a change" secs={proxies.chaos_max_secs} onchange={(v) => (proxies.chaos_max_secs = v)} />
            </div>
            <p class="hint">{`A random time in between, now ${shortDuration(proxies.chaos_min_secs)} to ${shortDuration(proxies.chaos_max_secs)}.`}</p>
          {/if}
          {#if proxies.mode === 'off'}
            <!-- The strategy's own description already says what Off does. -->
          {:else if proxies.mode !== 'failover'}
            <p class="hint">Rotation needs two reachable proxies. With only one, it is suspended and that proxy keeps carrying traffic.</p>
          {:else}
            <p class="hint">After a failure the service returns to an earlier proxy once it has stayed up for 2 minutes.</p>
          {/if}
        {/if}
        {#if stateLine !== ''}<p class="strategy-state" role="status">{stateLine}</p>{/if}
        {#if lanes.length > 0}<ul class="plain lane-list" aria-label="Proxy in use, per key">{#each lanes as l (l)}<li>{l}</li>{/each}</ul>{/if}
      </div>

      <div class="field policy">
        <span class="field-title" id="policy-title">When no proxy is reachable</span>
        <div class="policy-cards" role="radiogroup" aria-labelledby="policy-title">
          {#each POLICIES as p (p.value)}
            <label class="policy-card" class:on={proxies.offline === p.value} class:clearnet={p.clearnet}>
              <input type="radio" name="proxy-offline" value={p.value} checked={proxies.offline === p.value} onchange={() => (proxies.offline = p.value)} />
              <span class="policy-title">{p.title}</span>
              <span class="hint">{p.text}</span>
              {#if p.clearnet}<span class="clearnet-warning">Relays see this machine's IP address.</span>{/if}
            </label>
          {/each}
        </div>
      </div>
    </fieldset>
  {/if}
</section>
