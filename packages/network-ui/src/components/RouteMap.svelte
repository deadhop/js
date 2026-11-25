<script lang="ts">
  import { destination, firstRule, proxyName } from '../lib/routes';
  import { groupSummaries, keyLabel, mapRows, proxySummaries, reaches, ruleText, tiles, why } from '../lib/routeview';
  import type { KeyInfo, ProxyPool, NetworkSettings } from '../lib/schemas';

  // The top-level view: where every relay goes, as the service decided it,
  // and what each proxy is carrying. Read-only; changes are made in the
  // Relays, Proxies and Rules views.
  let {
    keys,
    live,
    pool,
  }: {
    keys: KeyInfo[];
    /** The saved settings (the routes are the service's, made from these). */
    live: NetworkSettings;
    /** What the service reports. */
    pool: ProxyPool;
  } = $props();

  let lane = $state<string | null>(null);
  let tryUrl = $state('');

  const rows = $derived(mapRows(pool.routes, lane));
  const top = $derived(tiles(pool.routes, live, pool));
  const summaries = $derived(proxySummaries(pool.routes, live, pool));
  const groups = $derived(groupSummaries(live.proxies, pool, keys));
  const fellBack = $derived([...new Set(pool.routes.filter((r) => r.reason === 'fallback').map((r) => r.relay))]);
  const dark = $derived([...new Set(pool.routes.filter((r) => r.via === 'off' && r.reason !== 'blocked').map((r) => r.relay))]);

  const proxyOf = (id: string | null) => live.proxies.list.find((e) => e.id === id);
  const color = (id: string | null) => {
    const i = live.proxies.list.findIndex((e) => e.id === id);
    return i < 0 ? '' : `proxy-c${i % 8}`;
  };
  const keysText = (ids: string[]) => (ids.length === keys.length && keys.length > 1 ? 'All keys' : ids.map((id) => keyLabel(keys, id)).join(', '));

  /** Where the address typed into "Try an address" would go, per key. */
  const tried = $derived.by(() => {
    const url = tryUrl.trim();
    if (!/^wss?:\/\/\S+$/.test(url)) return [];
    const rules = live.proxies.rules;
    const lines = keys.map((k) => {
      const i = firstRule(rules, k.id, url);
      if (i < 0) return { key: k.id, text: 'No rule matches: the default route' };
      const r = rules[i];
      return { key: k.id, text: `Rule ${i + 1} matches (${r.match.join(', ')}): ${destination(r.to, live.proxies).toLowerCase()}` };
    });
    return lines.every((l) => l.text === lines[0].text) ? [{ key: '', text: lines[0].text }] : lines;
  });
</script>

<div class="route-map">
    <div class="map-tools">
      <div class="field">
        <span class="field-title" id="lane-title">Show the routes of</span>
        <div class="segmented" role="radiogroup" aria-labelledby="lane-title">
          <label class:on={lane === null}><input type="radio" name="lane" checked={lane === null} onchange={() => (lane = null)} />All keys</label>
          {#each keys as k (k.id)}
            <label class:on={lane === k.id}><input type="radio" name="lane" checked={lane === k.id} onchange={() => (lane = k.id)} />{k.label}</label>
          {/each}
        </div>
      </div>
      <div class="field try">
        <label class="field-title" for="try-url">Try an address: which rule, which proxy?</label>
        <input id="try-url" class="mono" placeholder="wss://relay.example.com" bind:value={tryUrl} />
        {#each tried as t (t.key)}<p class="hint try-result" role="status">{t.key === '' ? t.text : `${keyLabel(keys, t.key)}: ${t.text}`}</p>{/each}
      </div>
    </div>

    {#if dark.length > 0}
      <p class="map-alert bad" role="alert">{`${dark.length === 1 ? '1 relay has' : `${dark.length} relays have`} no route now: ${dark.join(', ')}.`}</p>
    {/if}
    {#if fellBack.length > 0}
      <p class="map-alert warn" role="status">{`${fellBack.length === 1 ? '1 relay is' : `${fellBack.length} relays are`} on their rule's fallback because the proxy or group the rule names is down: ${fellBack.join(', ')}.`}</p>
    {/if}

    <div class="map-tiles">
      {#each top as t (t.label)}
        <div class={`map-tile ${t.tone}`}>
          <span class="lbl">{t.label}</span>
          <span class="map-tile-value">{t.value}</span>
          <span class="map-tile-line">{t.line}</span>
        </div>
      {/each}
    </div>

    <div class="map-table" role="table" aria-label="Route of every relay">
      <div class="map-row head" role="row">
        <span role="columnheader">Relay</span>
        <span role="columnheader">Keys</span>
        <span role="columnheader">Rule that matched</span>
        <span role="columnheader">Goes through</span>
        <span role="columnheader">Reaches</span>
      </div>
      {#each rows as r (`${r.relay} ${r.keys.join()}`)}
        {@const p = proxyOf(r.proxy)}
        {@const end = reaches(r.relay, r.via)}
        <div class={`map-row ${r.reason === 'fallback' ? 'fallback' : ''} ${r.via}`} role="row">
          <span role="cell" class="mono map-relay">{r.relay}</span>
          <span role="cell" class="map-keys">{keysText(r.keys)}</span>
          <span role="cell"><span class={`rule-pill ${r.rule === null ? 'default' : ''}`}><span class="rule-no">{r.rule ?? '·'}</span><span class="mono">{ruleText(live.proxies.rules, r.rule)}</span></span></span>
          <span role="cell" class="map-via">
            {#if r.via === 'proxy'}
              <span class={`via-pill ${color(r.proxy)}`}><span class="via-dot"></span>{p === undefined ? r.proxy : proxyName(p)}</span>
            {:else if r.via === 'direct'}
              <span class="via-pill direct"><span class="via-dot"></span>Direct</span>
            {:else}
              <span class="via-pill off"><span class="via-dot"></span>No connection</span>
            {/if}
            <span class="map-why">{why(r, r.keys[0], live.proxies)}</span>
          </span>
          <span role="cell" class="map-reach"><span>{end.what}</span><span class="map-why">{end.note}</span></span>
        </div>
      {:else}
        <p class="muted map-empty">No relay is listed.</p>
      {/each}
    </div>
    <p class="hint">The first matching rule wins; a relay no rule matches takes the default route. A dashed amber row is a fallback while its rule's proxy or group is down.</p>

    {#if summaries.length > 0}
      <h3 class="map-h">The proxies, and what each is carrying</h3>
      <div class="map-proxies">
        {#each summaries as s (s.id)}
          <div class="map-proxy">
            <div class="map-proxy-head">
              <span class={`via-pill ${color(s.id)}`}><span class="via-dot"></span>{s.name}</span>
              <span class={`map-proxy-state ${s.reachable === false ? 'warn' : s.reachable ? 'ok' : ''}`}>{s.reachable === null ? 'not checked' : s.reachable ? 'reachable' : 'down'}</span>
            </div>
            <span class="mono map-why">{s.url}</span>
            <span><b>{s.carries.length === 1 ? '1 relay' : `${s.carries.length} relays`}</b>{s.fallback.length > 0 ? ` (${s.fallback.length} as a fallback)` : ''}</span>
            <span class="map-why">{s.rules.length === 0 ? 'No rule points here' : `Rule${s.rules.length === 1 ? '' : 's'} ${s.rules.join(', ')} point${s.rules.length === 1 ? 's' : ''} here`}</span>
            <span class="map-why">{`${s.groups.length === 0 ? 'In no group' : `In ${s.groups.map((g) => `group ${g}`).join(', ')}`}${s.inDefault ? ' · on the default route' : ''}`}</span>
          </div>
        {/each}
      </div>
    {/if}

    {#if groups.length > 0}
      <h3 class="map-h">The groups, and the proxy each uses now</h3>
      <div class="map-proxies">
        {#each groups as g (g.id)}
          <div class="map-proxy">
            <div class="map-proxy-head">
              <span class="via-pill pool"><span class="via-dot"></span>{g.name}</span>
              <span class="map-proxy-state">{g.strategy}</span>
            </div>
            <span class="map-why">{g.members.join(' → ')}</span>
            {#each g.lines as l (l.key)}
              <span class={`map-proxy-state ${l.tone === 'ok' ? 'ok' : 'warn'}`}>{l.key === '' ? l.text : `${keyLabel(keys, l.key)}: ${l.text}`}</span>
            {:else}
              <span class="map-why">No key uses it now</span>
            {/each}
            <span class="map-why">{g.inDefault ? 'On the default route' : 'Not on the default route'}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
