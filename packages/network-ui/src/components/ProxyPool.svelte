<script lang="ts">
  import type { NetworkApi } from '../lib/network-api';
  import { I2P_PORT, MAX_PROXIES, buildProxy, editedUrl, i2pProxy, i2pRule, i2pRuleIndex, isNew, newEntry, parseProxy, type ProxyFields, type ProxyKind } from '../lib/proxy';
  import { MAX_RULES, POLICIES, destination, keysUsing, proxyName, usedBy } from '../lib/routes';
  import { defaultGroup, groupStateText, keyLabel } from '../lib/routeview';
  import type { KeyInfo, ProxyCheck, ProxyPool, ProxySettings } from '../lib/schemas';
  import ProxyGroups from './ProxyGroups.svelte';
  import ProxyStatus from './ProxyStatus.svelte';
  import KeyUse from './KeyUse.svelte';

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
    /** The service's keys. */
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

  const full = $derived(proxies.list.length >= MAX_PROXIES);

  /** What a proxy carries now and what points at it. */
  function carrying(id: string, used: string[]): string {
    const relays = new Set((pool?.routes ?? []).filter((r) => r.proxy === id).map((r) => r.relay)).size;
    const carries = `Carries ${relays === 1 ? '1 relay' : `${relays} relays`} now`;
    return used.length === 0 ? `${carries} · nothing points at it yet` : `${carries} · used by ${used.join(', ')}`;
  }

  function statusOf(id: string) {
    return pool?.proxies.find((p) => p.id === id) ?? null;
  }

  // ---- create and edit ----
  let draft = $state<{ index: number | null; name: string; fields: ProxyFields } | null>(null);
  let draftError = $state('');
  /** Said once the first proxy became the default route. */
  let notice = $state('');

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
    if (d.index === null) {
      const entry = newEntry(name, built.url, i2p, proxies.list.map((e) => e.id));
      // The first proxy (not an I2P router, which carries .i2p relays only)
      // becomes the default route, as it always did; it can be changed under Rules.
      const first = !i2p && proxies.default === 'direct' && !proxies.list.some((e) => e.i2p !== true);
      proxies.list = [...proxies.list, entry];
      if (first) {
        proxies.default = { proxy: entry.id };
        notice = `Everything else now goes through ${proxyName(entry)}: it is the default route. Change that under Rules, in the last row.`;
      }
    } else proxies.list = proxies.list.map((e, i) => (i === d.index ? { ...e, name, url: built.url, i2p } : e));
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
  /** The proxy or group a destination names, as shown. */
  const named = (d: ProxyPool['default']) => destination(d, proxies);

  /** What a default route does now, from its state, in words. */
  function routeState(d: ProxyPool['default'], state: ProxyPool['state'], g: Parameters<typeof groupStateText>[0] | null): string {
    switch (state) {
      case 'transparent':
        return 'Transparent proxy declared: nothing is checked.';
      case 'direct':
        return 'direct: relays that no rule matches connect straight';
      case 'blocked':
        return 'blocked: relays that no rule matches are not connected';
      case 'offline':
        return `offline: ${typeof d === 'object' && 'group' in d ? `no proxy in ${named(d)} is reachable` : `${named(d)} is down`} · ${POLICIES.find((p) => p.value === pool!.offline)!.title.toLowerCase()}`;
      default:
        return g === null ? `${named(d)}, reachable` : `${named(d)}, ${groupStateText(g, pool!)}`;
    }
  }

  /** The default route now (the public invoices key's, as the service reports it). */
  const stateLine = $derived.by((): string => {
    if (pool === null) return '';
    if (pool.state === 'transparent') return routeState(pool.default, pool.state, null);
    return `Default route: ${routeState(pool.default, pool.state, defaultGroup(pool))}.`;
  });
  /** One line per key when the keys have default routes of their own. */
  const lanes = $derived.by((): string[] => {
    if (pool === null || Object.keys(proxies.default_keys).length === 0) return [];
    return pool.lanes.map((l) => {
      const label = keyLabel(keys, l.key);
      const g = typeof l.default === 'object' && 'group' in l.default ? (l.groups.find((x) => x.group === (l.default as { group: string }).group) ?? null) : null;
      return `${label}: ${routeState(l.default, l.state, g)}`;
    });
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
      <legend class="field-title">Proxy list</legend>
      {#if proxies.list.length === 0}
        <p class="muted">No proxies. Relays connect straight to this machine.</p>
      {/if}
      {#if notice !== ''}<p class="note" role="status">{notice}</p>{/if}
      <ol class="proxy-list">
        {#each proxies.list as entry, i (entry.id)}
          {@const st = statusOf(entry.id)}
          {@const t = tests[entry.id]}
          {@const used = usedBy(proxies, { proxy: entry.id }, keys)}
          <li class="proxy-row">
            <span class="pos mono" aria-hidden="true">{i + 1}</span>
            <span class="proxy-id">
              <span class="proxy-name">{entry.name === '' ? 'Unnamed proxy' : entry.name}{#if entry.i2p}<span class="badge i2p-badge">I2P router</span>{/if}</span>
              <code class="mono">{entry.url}</code>
            </span>
            <span class="proxy-state">
              {#if (pool?.routes ?? []).some((r) => r.proxy === entry.id)}<span class="badge confirmed">in use</span>{/if}
              {#if isNew(entry, live.list)}
                <span class="badge not_checked">not saved</span>
              {:else if st === null || st.reachable === null}
                <span class="badge not_checked">not checked</span>
              {:else if st.reachable}
                <span class="badge pass">reachable</span>
              {:else}
                <span class="badge fail" title={st.reason ?? ''}>unreachable</span>
              {/if}
            </span>
            <div class="proxy-routes"><span class="hint">{carrying(entry.id, used)}</span><KeyUse {keys} used={keysUsing(proxies, { proxy: entry.id }, keys)} label={`Proxy ${i + 1}`} /></div>
            <div class="proxy-foot">
              <span class="proxy-actions">
                <button type="button" class="sm" aria-label={`Test proxy ${i + 1}`} disabled={t?.checking === true} onclick={() => void test(i)}>{t?.checking ? 'Testing…' : 'Test'}</button>
                <button type="button" class="sm" aria-label={`Edit proxy ${i + 1}`} onclick={() => edit(i)}>Edit</button>
                <button type="button" class="sm remove" aria-label={`Remove proxy ${i + 1}`} disabled={used.length > 0} title={used.length > 0 ? `Used by ${used.join(', ')}: change those first.` : undefined} onclick={() => remove(i)}>Remove</button>
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
                <p class="hint">Your I2P router's HTTP proxy, usually port 4444. I2P names are looked up through it. Only rules that name it send relays through it.</p>
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
            <p class="hint">{`Rule ${i2pRuleAt + 1} decides where .i2p relays go: ${destination(proxies.rules[i2pRuleAt].to, proxies).toLowerCase()}.`}</p>
          {:else}
            <div class="test-row">
              <button type="button" onclick={() => routeI2p(router!.id)} disabled={proxies.rules.length >= MAX_RULES}>Send .i2p relays through this proxy</button>
              <span class="hint inline">Adds a rule. Until then .i2p relays take the default route.</span>
            </div>
          {/if}
        </div>
      {/if}

      <ProxyGroups {keys} {proxies} {live} {pool} />

      <div class="field strategy">
        <span class="field-title">Default route</span>
        <p class="hint">{`Relays that no rule matches go to ${destination(proxies.default, proxies).toLowerCase()}${Object.keys(proxies.default_keys).length > 0 ? ', unless their key has a default route of its own' : ''}. Change it under Rules, in the last row.`}</p>
        {#if stateLine !== ''}<p class="strategy-state" role="status">{stateLine}</p>{/if}
        {#if lanes.length > 0}<ul class="plain lane-list" aria-label="Default route, per key">{#each lanes as l (l)}<li>{l}</li>{/each}</ul>{/if}
      </div>

      <div class="field policy">
        <span class="field-title" id="policy-title">When the default route has nothing reachable</span>
        <p class="hint">The same policy applies to a rule that follows the offline policy, and to a rule's fallback when that has nothing reachable either.</p>
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
