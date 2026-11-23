<script lang="ts">
  // The Network tab: how each relay is routed, the relays and who uses them,
  // the proxies and the routing rules. It edits the same form as the rest of
  // the settings; the page around it saves it.
  import { poll } from '../lib/poll';
  import type { NetworkApi } from '../lib/network-api';
  import { ADMIN, dependents, proxiesOf, relayUsers, relaysOf } from '../lib/keys';
  import type { I2pLookup, RelayHealth, RelayHistory, Settings, SettingsView } from '../lib/schemas';
  import type { NetworkHealth } from '../lib/network-api';
  import { errorRate, i2pName, lookupLine, registryHost, relayProblem, statsFor, withHost } from '../lib/relays';
  import { REASONS, destination, firstRule, proxyName } from '../lib/routes';
  import { mapRows, trace } from '../lib/routeview';
  import KeyChips from './KeyChips.svelte';
  import ProxyPool from './ProxyPool.svelte';
  import RouteMap from './RouteMap.svelte';
  import Rules from './Rules.svelte';

  type NetworkView = 'routes' | 'relays' | 'proxies' | 'rules';

  let {
    api,
    view,
    form = $bindable(),
    error = $bindable(),
    dashboardRelays,
    networkView = 'routes',
    confirm,
    removeRelay,
    useRelay,
  }: {
    api: NetworkApi;
    view: SettingsView;
    form: Settings;
    error: string;
    /** Relays this page itself uses (from config.json). */
    dashboardRelays: string[];
    /** The view to open on. */
    networkView?: NetworkView;
    confirm: (message: string) => boolean;
    /** Remove a relay (asking which relay takes over for a key that depends on it). */
    removeRelay: (url: string) => void;
    /** Switch one key on or off for a relay. */
    useRelay: (url: string, id: string, on: boolean) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let netView = $state<NetworkView>(networkView);
  /** The relay whose "Why" panel is open. */
  let why = $state<string | null>(null);

  // A day of relay results, for the error rate beside each relay; optional here.
  let history = $state<RelayHistory | null>(null);
  $effect(() => {
    api.getRelayHistory('1d').then(
      (h) => (history = h),
      () => (history = null),
    );
  });

  const HEALTH_EVERY_MS = 10_000;

  // What the service says about its proxies, for the status beside each; optional here.
  let health = $state<NetworkHealth | null>(null);
  // Ask the service to check every relay now (each the way it connects: its
  // route), then show the results under the relays.
  let testing = $state(false);
  async function testRelays() {
    testing = true;
    error = '';
    try {
      await api.checkRelays();
      await loadHealth();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      testing = false;
    }
  }
  /** One relay's last check, in words. */
  const checkLine = (c: RelayHealth) =>
    [
      c.connects ? 'connects' : 'does not connect',
      c.forwards === null ? null : c.forwards ? 'carries events' : 'does not carry events',
      c.rate_limited ? 'rate-limiting us' : null,
      c.ms === null ? null : `${c.ms} ms`,
    ]
      .filter((x) => x !== null)
      .join(' · ');

  const loadHealth = () =>
    api.getHealth().then(
      (h) => (health = h),
      () => (health = null),
    );
  // Read when the page opens, and again every so often: the service probes its proxies on its own.
  $effect(() => {
    return poll(loadHealth, HEALTH_EVERY_MS);
  });

  let newRelay = $state('');
  // Why the relay being added was refused, shown beside the box it was typed in.
  let relayError = $state('');

  function addRelay() {
    const url = newRelay.trim();
    relayError = relayProblem(url, view.fixed.network, form.relays);
    if (relayError !== '') return;
    if (typedName !== null) {
      void lookUpRelay(url, typedName);
      return;
    }
    form.relays = [...form.relays, url];
    newRelay = '';
  }

  // ---- I2P names ----
  // With an I2P router proxy saved, a relay typed by its .i2p name is looked up
  // once, through public registries, and added under the .b32.i2p address found.
  const routerSaved = $derived(view !== null && view.settings.proxies.list.some((e) => e.i2p === true));
  const typedName = $derived(routerSaved ? i2pName(newRelay) : null);
  /** The lookup for the relay being added. */
  let found = $state<{ url: string; result: I2pLookup } | null>(null);
  let looking = $state(false);

  async function lookUpRelay(url: string, name: string) {
    looking = true;
    found = null;
    try {
      found = { url, result: await api.resolveI2pName(name) };
    } catch (e) {
      relayError = (e as Error).message;
    } finally {
      looking = false;
    }
  }

  function addFound() {
    const f = found!;
    const url = withHost(f.url, f.result.address);
    relayError = relayProblem(url, view.fixed.network, form.relays);
    if (relayError !== '') return;
    form.relays = [...form.relays, url];
    form.relay_names = { ...form.relay_names, [url]: f.result.name };
    newRelay = '';
    found = null;
  }

  /** A named relay looked up again. */
  let again = $state<{ relay: string; result: I2pLookup | null; error: string } | null>(null);

  async function lookUpAgain(relay: string, name: string) {
    again = { relay, result: null, error: '' };
    try {
      again = { relay, result: await api.resolveI2pName(name), error: '' };
    } catch (e) {
      again = { relay, result: null, error: (e as Error).message };
    }
  }

  /** Move a relay to a new address: its keys, its name and the rules that name it go along. */
  function moveRelay(from: string, to: string, name: string) {
    const problem = relayProblem(to, view.fixed.network, form.relays);
    if (problem !== '') {
      again = { ...again!, error: problem };
      return;
    }
    if (!confirm(`Replace ${from} with ${to}? Its keys, name and rules move to the new address.`)) return;
    const f = form;
    const renamed = <T,>(m: Record<string, T>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k === from ? to : k, v]));
    f.relays = f.relays.map((r) => (r === from ? to : r));
    f.relay_keys = renamed(f.relay_keys);
    f.relay_names = { ...renamed(f.relay_names), [to]: name };
    f.proxies.rules = f.proxies.rules.map((r) => ({ ...r, match: r.match.map((m) => (m === from ? to : m)) }));
    again = null;
  }

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  // The keys, as the service lists them.
  const keys = $derived(view.fixed.keys);
  const ids = $derived(keys.map((k) => k.id));
  // This page signs in through the administration key: it must keep one of the relays this page uses.
  const unreachable = $derived(!dashboardRelays.some((r) => relaysOf(form.relays, form.relay_keys, ADMIN, ids).includes(r)));
</script>

{#snippet lookupResult(l: I2pLookup)}
  <p class="i2p-line"><span class="mono">{lookupLine(l)}</span></p>
  {#if l.disagreeing.length > 0}
    <p class="i2p-warning" role="alert">
      {`Registries disagree: ${l.disagreeing.map((d) => `${registryHost(d.registry)} gives ${d.address}`).join('; ')}. One of them may point to someone else's relay. Check the address with the relay's operator before you use it.`}
    </p>
  {/if}
  {#if l.unreachable.length > 0}<p class="hint">{`Not reached: ${l.unreachable.map(registryHost).join(', ')}.`}</p>{/if}
{/snippet}

  <div class="network-nav segmented" role="tablist" aria-label="Network">
    {#each [['routes', 'Routes', null], ['relays', 'Relays', form.relays.length], ['proxies', 'Proxies', form.proxies.list.length], ['rules', 'Rules', form.proxies.rules.length]] as [id, label, n] (id)}
      <button type="button" role="tab" aria-selected={netView === id} class:on={netView === id} onclick={() => (netView = id as NetworkView)}>{label}{#if n !== null}<span class="count">{n}</span>{/if}</button>
    {/each}
  </div>
  {#if netView === 'routes'}
    {#if health === null}
      <p class="muted" role="status">Reading the routes from the service…</p>
    {:else}
      <RouteMap {keys} live={view.settings} pool={health.proxy_pool} />
    {/if}
  {:else if netView === 'rules'}
    <Rules {keys} {form} saved={view.settings.proxies.list} pool={health?.proxy_pool ?? null} {dashboardRelays} locked={view.fixed.proxy_locked} onproxies={() => (netView = 'proxies')} />
  {:else if netView === 'relays'}
  <section class="card" aria-labelledby="s-conn">
    <div class="card-head">
      <h2 id="s-conn">Relays</h2>
      <button type="button" class="sm relays-test" onclick={() => void testRelays()} disabled={testing}>{testing ? 'Testing…' : 'Test relays'}</button>
    </div>
    <ul class="plain key-explain" aria-label="Keys">
      {#each keys as k (k.id)}
        <li>
          <strong>{k.label}</strong>
          <span class="muted">{k.operators_only ? 'Operators sign in here to manage the service. Nobody else is answered.' : 'Customers and apps create and look up invoices here.'}</span>
          <span class="count">{`${plural(relaysOf(form.relays, form.relay_keys, k.id, ids).length, 'relay')} · ${form.proxies.list.length === 0 ? 'no proxies' : plural(proxiesOf(form.proxies, k.id, ids).length, 'proxy', 'proxies')}`}</span>
        </li>
      {/each}
    </ul>
    <div class="field">
      <span class="field-title">Relays</span>
      <ul class="plain relay-edit">
        {#each form.relays as r (r)}
          {@const st = statsFor(history, r)}
          {@const check = health?.relay_health.find((c) => c.relay.replace(/\/$/, '') === r.replace(/\/$/, ''))}
          {@const routes = mapRows((health?.proxy_pool.routes ?? []).filter((x) => x.relay === r), null)}
          {@const name = form.relay_names[r]}
          <li>
            {#if name}
              <span class="relay-url relay-named"><strong>{name}</strong><code class="mono">{r}</code></span>
            {:else}
              <code class="relay-url mono">{r}</code>
            {/if}
            {#if st}
              {@const rate = errorRate(st)}
              <span class={`rate-chip ${rate.tone}`} title="Failed health checks and replies, last 24 hours">{`${rate.text} errors · 24 h`}</span>
            {/if}
            <KeyChips
              {keys}
              assigned={relayUsers(form.relay_keys, r, ids)}
              required={dependents(form.relays, form.relay_keys, r, ids, dashboardRelays)}
              requiredWhy="its only relay, or the only one this page connects through, so it stays on."
              label={r}
              onchange={(id, on) => useRelay(r, id, on)}
            />
            {#if routes.length === 1}
              {@const p = form.proxies.list.find((e) => e.id === routes[0].proxy)}
              <span class={`via-pill ${routes[0].via === 'proxy' ? `proxy-c${form.proxies.list.indexOf(p!) % 8}` : routes[0].via}`} title={REASONS[routes[0].reason]}><span class="via-dot"></span>{routes[0].via === 'proxy' ? proxyName(p ?? { name: '', url: routes[0].proxy! }) : routes[0].via === 'direct' ? 'Direct' : 'No connection'}</span>
            {:else if routes.length > 1}
              <span class="via-pill"><span class="via-dot"></span>Differs per key</span>
            {/if}
            <button type="button" class="sm" aria-expanded={why === r} aria-label={`Why ${r} goes this way`} onclick={() => (why = why === r ? null : r)}>Why</button>
            {#if name && routerSaved}
              <button type="button" class="sm" aria-label={`Look up ${name} again`} disabled={again?.relay === r && again.result === null && again.error === ''} onclick={() => void lookUpAgain(r, name)}>Look up again</button>
            {/if}
            <button type="button" class="sm remove" onclick={() => removeRelay(r)} disabled={form.relays.length === 1} aria-label={`Remove ${r}`}>Remove</button>
            {#if check}
              <span class={`relay-check ${check.status}`} role="status" aria-label={`${r}: last check`}>
                <span class={`dot ${check.status === 'ok' ? 'ok' : check.status === 'degraded' ? 'warn' : 'bad'}`} aria-hidden="true"></span>
                <span>{checkLine(check)}</span>
                {#if check.status !== 'ok' && check.detail !== ''}<span class="relay-check-why">{check.detail}</span>{/if}
              </span>
            {/if}
            {#if again?.relay === r}
              {@const a = again}
              <div class="i2p-found" role="region" aria-label={`Lookup of ${name}`}>
                {#if a.error !== ''}
                  <p class="field-error" role="alert">{a.error}</p>
                {:else if a.result === null}
                  <p class="hint" role="status">{`Asking the registries about ${name}. This can take a minute.`}</p>
                {:else}
                  {@render lookupResult(a.result)}
                  {#if withHost(r, a.result.address) === r}
                    <p class="note">The address has not changed.</p>
                  {:else}
                    <p class="field-error" role="alert">{`The address has changed. The relay is saved as ${r}.`}</p>
                  {/if}
                {/if}
                <div class="test-row">
                  {#if a.result !== null && withHost(r, a.result.address) !== r}
                    <button type="button" class="sm primary" onclick={() => moveRelay(r, withHost(r, a.result!.address), a.result!.name)}>Use the new address</button>
                  {/if}
                  <button type="button" class="sm" onclick={() => (again = null)}>Close</button>
                </div>
              </div>
            {/if}
            {#if why === r}
              <div class="relay-why" role="region" aria-label={`Why ${r} goes this way`}>
                {#each keys.filter((k) => relayUsers(form!.relay_keys, r, ids).includes(k.id)) as k (k.id)}
                  {@const live = routes.find((x) => x.keys.includes(k.id))}
                  <div class="relay-why-key">
                    <b>{k.label}</b>
                    <span class="hint">{live === undefined ? 'Not reported by the service yet.' : `Now: ${live.via === 'proxy' ? proxyName(form.proxies.list.find((e) => e.id === live.proxy) ?? { name: '', url: live.proxy! }) : live.via === 'direct' ? 'direct' : 'no connection'}, ${REASONS[live.reason]}.`}</span>
                    <ol class="plain relay-trace" aria-label={`Rules checked for ${k.label}`}>
                      {#each trace(form.proxies.rules, k.id, r) as c (c.no)}
                        <li class:matched={c.matched}><span>{c.matched ? '✓' : '–'}</span><span>{c.no}</span><span class="mono">{c.match}</span><span>{c.matched ? `matched: ${destination(form.proxies.rules[c.no - 1].to, form.proxies.list).toLowerCase()}` : c.forKey ? 'no match' : `not for ${k.label}`}</span></li>
                      {:else}
                        <li><span>·</span><span></span><span>No rules</span><span>default route</span></li>
                      {/each}
                      {#if firstRule(form.proxies.rules, k.id, r) < 0 && form.proxies.rules.length > 0}<li><span>·</span><span></span><span>No rule matched</span><span>default route</span></li>{/if}
                    </ol>
                  </div>
                {/each}
                <button type="button" class="sm" onclick={() => (netView = 'rules')}>Open the rules</button>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
      <div class="add-relay">
        <label class="visually-hidden" for="relay">Add relay</label>
        <input
          id="relay"
          class="mono"
          placeholder="wss://relay.example.com"
          aria-invalid={relayError !== ''}
          aria-describedby={relayError !== '' ? 'relay-error' : undefined}
          bind:value={newRelay}
          oninput={() => {
            relayError = '';
            found = null;
          }}
        />
        <button type="button" onclick={addRelay} disabled={form.relays.length >= 8 || looking}>{typedName === null ? 'Add' : looking ? 'Looking up…' : 'Look up'}</button>
      </div>
      {#if relayError !== ''}<p id="relay-error" class="field-error" role="alert">{relayError}</p>{/if}
      {#if looking}<p class="hint" role="status">Asking the I2P name registries through your I2P router. This can take a minute.</p>{/if}
      {#if found}
        <div class="i2p-found" role="region" aria-label="Lookup result">
          {@render lookupResult(found.result)}
          <div class="test-row">
            <button type="button" class="sm primary" onclick={addFound}>Add as this address</button>
            <button type="button" class="sm" onclick={() => (found = null)}>Cancel</button>
          </div>
        </div>
      {/if}
      {#if relayError === '' && /^wss?:\/\/\S+$/.test(newRelay.trim())}
        {@const url = newRelay.trim()}
        {@const lines = keys.map((k) => {
          const i = firstRule(form!.proxies.rules, k.id, url);
          return i < 0 ? 'no rule matches: the default route' : `rule ${i + 1} (${form!.proxies.rules[i].match.join(', ')}) would match: ${destination(form!.proxies.rules[i].to, form!.proxies.list).toLowerCase()}`;
        })}
        <p class="hint relay-preview" role="status">{lines.every((l) => l === lines[0]) ? `Before you add it: ${lines[0]}.` : `Before you add it: ${keys.map((k, i) => `${k.label}: ${lines[i]}`).join('; ')}.`}</p>
      {/if}
      <p class="hint">
        On mainnet relays use <span class="mono">wss://</span>. Plain <span class="mono">ws://</span> is for a relay on this machine, or on Tor
        (<span class="mono">.onion</span>), I2P (<span class="mono">.i2p</span>) or FIPS (<span class="mono">.fips</span>), which encrypt the connection
        themselves. Those need a proxy that can reach them. Saving reconnects: if no relay connects, the previous list comes back. If none stays connected for
        10 minutes later on, the service goes back to <span class="mono">DEADHOP_RELAYS</span> by itself.
      </p>
      {#if unreachable}
        <p class="error" role="alert">
          {`This page signs in through the administration key, over ${dashboardRelays.join(', ')}. Keep one of them for that key, or update config.json before saving.`}
        </p>
      {/if}
    </div>

  </section>

  {:else}
    <ProxyPool {api} {keys} proxies={form.proxies} live={view.settings.proxies} pool={health?.proxy_pool ?? null} locked={view.fixed.proxy_locked} />
  {/if}
