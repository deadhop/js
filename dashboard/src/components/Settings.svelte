<script lang="ts">
  import Loading from './Loading.svelte';
  import type { PayApi, SettingsPatch } from '../lib/api';
  import { ADMIN, assignmentProblem, dependents, relayKeysFor, relayKeysText, relayUsers, relaysOf, replacements, toggled } from '../lib/keys';
  import { i2pProxy, proxiesPatch } from '../lib/proxy';
  import type { Settings, SettingsView } from '../lib/schemas';
  import { proxyName, rulesProblem } from '../lib/routes';
  import I2pRegistries from './I2pRegistries.svelte';
  import NetworkSection from './NetworkSection.svelte';
  import Warnings from './Warnings.svelte';

  let {
    api,
    dashboardRelays,
    onChanged,
    confirm = (message: string) => window.confirm(message),
    showSweep = false,
    section = 'general',
    networkView = 'routes',
  }: {
    api: PayApi;
    /** Relays this page itself uses (from config.json). */
    dashboardRelays: string[];
    onChanged: () => void;
    confirm?: (message: string) => boolean;
    /** The PayJoin / CoinJoin sweep card; off until the sweep is implemented. */
    showSweep?: boolean;
    /** Which cards to show: relays and proxies (the Network tab), or everything else. */
    section?: 'general' | 'network';
    /** The Network tab's view to open on. */
    networkView?: NetworkView;
  } = $props();

  type NetworkView = 'routes' | 'relays' | 'proxies' | 'rules';

  let view = $state<SettingsView | null>(null);
  let form = $state<Settings | null>(null);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  function show(v: SettingsView) {
    view = v;
    form = structuredClone($state.snapshot(v.settings)) as Settings;
    // A fresh form has nothing wrong with it (a discarded change takes its error along).
    error = '';
  }

  async function run(action: () => Promise<SettingsView>, done: string) {
    busy = true;
    error = '';
    notice = '';
    try {
      show(await action());
      notice = done;
      onChanged();
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  $effect(() => {
    api.getSettings().then(show, (e: Error) => (error = e.message));
  });

  const isOverridden = (name: string) => view!.overridden.includes(name);

  /** Only the fields that differ from the live settings. */
  function diff(): SettingsPatch | string {
    const live = view!.settings;
    const f = form!;
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(f) as (keyof Settings)[]) {
      if (key === 'sweep' || key === 'relays' || key === 'relay_keys' || key === 'relay_names' || key === 'proxies') continue;
      if (f[key] === null) return 'Fill in every number.';
      if (f[key] !== live[key]) patch[key] = f[key];
    }
    if (JSON.stringify(f.relays) !== JSON.stringify(live.relays)) patch.relays = [...f.relays];
    // Names only change what is shown: they never reconnect.
    const names = (m: Record<string, string>) => JSON.stringify(Object.entries(m).sort());
    if (names(f.relay_names) !== names(live.relay_names)) patch.relay_names = { ...f.relay_names };
    // Which keys use which relays: only the restricted relays are saved.
    const problem = assignmentProblem(keys, f) || rulesProblem(f, keys, live.proxies.list, dashboardRelays);
    if (problem !== '') return problem;
    const assigned = relayKeysFor(f.relays, f.relay_keys, ids);
    if (relayKeysText(assigned) !== relayKeysText(relayKeysFor(live.relays, live.relay_keys, ids))) patch.relay_keys = assigned;
    const sweep: Record<string, unknown> = {};
    for (const key of Object.keys(f.sweep) as (keyof Settings['sweep'])[]) {
      if (f.sweep[key] === null) return 'Fill in every number.';
      if (f.sweep[key] !== live.sweep[key]) sweep[key] = f.sweep[key];
    }
    if (Object.keys(sweep).length > 0) patch.sweep = sweep;
    const proxies = proxiesPatch(live.proxies, f.proxies);
    if (typeof proxies === 'string') return proxies;
    if (Object.keys(proxies).length > 0) patch.proxies = proxies;
    return patch as SettingsPatch;
  }

  async function save() {
    const patch = diff();
    if (typeof patch === 'string') {
      error = patch;
      return;
    }
    if (Object.keys(patch).length === 0) {
      notice = 'Nothing to save.';
      return;
    }
    if (unreachable && !confirm(`This page reaches the service through ${dashboardRelays.join(', ')}, and the administration key would no longer use any of them. This page loses access until the service goes back to its own relays (up to 10 minutes). Save anyway?`)) {
      return;
    }
    if ((patch.relays || patch.relay_keys || patch.proxies !== undefined) && !confirm('The service will reconnect to its relays, or switch proxy. If none connect, the change is undone automatically. Continue?')) {
      return;
    }
    await run(() => api.updateSettings(patch), 'Saved.');
  }

  async function reset() {
    if (!confirm('Forget every setting changed here and use the values from the environment?')) return;
    await run(() => api.resetSettings(), 'Back to the environment values.');
  }


  // Removing a relay that a key depends on first asks which relay takes over.
  let replacing = $state<{ url: string; picks: Record<string, string> } | null>(null);
  let replaceDialog = $state<HTMLDialogElement | null>(null);

  function removeRelay(url: string) {
    const needed = dependents(form!.relays, form!.relay_keys, url, ids, dashboardRelays);
    if (needed.length === 0) {
      dropRelay(url);
      return;
    }
    replacing = { url, picks: Object.fromEntries(needed.map((k) => [k, replacements(form!.relays, url, k, dashboardRelays)[0] ?? ''])) };
    queueMicrotask(() => replaceDialog?.showModal?.());
  }

  function dropRelay(url: string) {
    form!.relays = form!.relays.filter((r) => r !== url);
    form!.relay_keys = relayKeysFor(form!.relays, form!.relay_keys, ids);
    form!.relay_names = Object.fromEntries(Object.entries(form!.relay_names).filter(([r]) => r !== url));
  }

  function replaceAndRemove() {
    const r = replacing!;
    for (const [key, to] of Object.entries(r.picks)) {
      if (!form!.relays.includes(to)) form!.relays = [...form!.relays, to];
      useRelay(to, key, true);
    }
    dropRelay(r.url);
    closeReplace();
  }

  function closeReplace() {
    replaceDialog?.close();
    replacing = null;
  }

  const keyLabel = (id: string) => keys.find((k) => k.id === id)!.label;

  /** Switch one key on or off for a relay. */
  function useRelay(url: string, id: string, on: boolean) {
    const assigned = toggled(relayUsers(form!.relay_keys, url, ids), id, on, ids);
    form!.relay_keys = relayKeysFor(form!.relays, { ...form!.relay_keys, [url]: assigned }, ids);
  }


  // The keys, as the service lists them.
  const keys = $derived(view!.fixed.keys);
  const ids = $derived(keys.map((k) => k.id));
  // This page signs in through the administration key: it must keep one of the relays this page uses.
  const unreachable = $derived(
    form !== null && !dashboardRelays.some((r) => relaysOf(form!.relays, form!.relay_keys, ADMIN, ids).includes(r)),
  );

  /** What the save bar says: a problem with the form, or how many settings would change. */
  const pending = $derived.by((): { count: number; problem: string; reconnects: boolean } => {
    const d = diff();
    if (typeof d === 'string') return { count: 0, problem: d, reconnects: false };
    return { count: Object.keys(d).length, problem: '', reconnects: d.relays !== undefined || d.relay_keys !== undefined || d.proxies !== undefined };
  });

</script>

{#snippet mark(name: string)}{#if isOverridden(name)}<span>{' *'}</span>{/if}{/snippet}

<header class="page-head">
  <div>
    {#if section === 'network'}
      <p class="eyebrow">Network</p>
      <h1>How the service is reached</h1>
      <p class="muted">The relays each key listens on, and the proxies between them and this machine. Saving reconnects; if nothing connects, the previous setup comes back.</p>
    {:else}
      <p class="eyebrow">Settings</p>
      <h1>How the service behaves</h1>
      <p class="muted">Changes are saved as overrides on top of the host's environment. Every change is a signed, one-time request and goes into the audit log.</p>
    {/if}
  </div>
  {#if view}
    <div class="page-actions">
      {#if view.overridden.length > 0}<span class="badge detected">{`${view.overridden.length} overridden`}</span>{/if}
      {#if section === 'general'}
        <button type="button" onclick={reset} disabled={busy || view.overridden.length === 0}>Reset to environment</button>
      {/if}
    </div>
  {/if}
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if notice}<p class="note" role="status">{notice}</p>{/if}
{#if !view && !error}<Loading label={section === 'network' ? 'Loading the network settings' : 'Loading settings'} />{/if}

{#if view && form}
  <Warnings warnings={view.warnings} />
  {#if view.restart_pending}<p class="note" role="status">Reconnecting to the relays…</p>{/if}

  <form
    class="settings"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    {#if section === 'network'}
      <NetworkSection {api} {view} bind:form bind:error {dashboardRelays} {networkView} {confirm} {removeRelay} {useRelay} />
    {:else}

      <section class="card" aria-labelledby="s-abuse">
        <h2 id="s-abuse">Abuse protection</h2>
        <div class="grid2">
          <div class="field">
            <label for="pow">Proof of work (bits){@render mark('pow_bits')}</label>
            <input id="pow" type="number" min="0" max="64" bind:value={form.pow_bits} />
            <p class="hint">Each extra bit doubles the cost for customers and attackers alike. 20 bits is about a second in a browser.</p>
          </div>
          <div class="field">
            <label for="window">Request age limit (s){@render mark('pow_window_secs')}</label>
            <input id="window" type="number" min="30" max="3600" bind:value={form.pow_window_secs} />
          </div>
          <div class="field">
            <label for="rate-global">Public invoices / min{@render mark('rate_global_per_min')}</label>
            <input id="rate-global" type="number" min="1" bind:value={form.rate_global_per_min} />
          </div>
          <div class="field">
            <label for="rate-key">Public invoices / min / key{@render mark('rate_per_key_per_min')}</label>
            <input id="rate-key" type="number" min="1" bind:value={form.rate_per_key_per_min} />
          </div>
          <div class="field">
            <label for="req-global">Public requests / min{@render mark('rate_requests_per_min')}</label>
            <input id="req-global" type="number" min="1" bind:value={form.rate_requests_per_min} />
          </div>
          <div class="field">
            <label for="req-key">Public requests / min / key{@render mark('rate_requests_per_key_per_min')}</label>
            <input id="req-key" type="number" min="1" bind:value={form.rate_requests_per_key_per_min} />
          </div>
        </div>
        <label class="check"><input id="public" type="checkbox" bind:checked={form.public_invoicing} /> Public invoicing{@render mark('public_invoicing')}</label>
      </section>

      <section class="card" aria-labelledby="s-invoices">
        <h2 id="s-invoices">Invoices and payments</h2>
        <div class="grid2">
          <div class="field"><label for="name">Name{@render mark('name')}</label><input id="name" bind:value={form.name} maxlength="60" /></div>
          <div class="field">
            <label for="confs">Confirmations{@render mark('min_confirmations')}</label>
            <input id="confs" type="number" min="1" max="144" bind:value={form.min_confirmations} />
            <p class="hint">Raise it for larger amounts: a one-block reorg is not noticed at 1.</p>
          </div>
          <div class="field">
            <label for="min-amount">Smallest invoice (sats){@render mark('min_amount_sat')}</label>
            <input id="min-amount" type="number" min="1" bind:value={form.min_amount_sat} />
          </div>
          <div class="field">
            <label for="max-amount">Largest invoice (sats){@render mark('max_amount_sat')}</label>
            <input id="max-amount" type="number" min="1" bind:value={form.max_amount_sat} />
          </div>
          <div class="field">
            <label for="default-expiry">Default lifetime (s){@render mark('default_expiry_secs')}</label>
            <input id="default-expiry" type="number" min="60" bind:value={form.default_expiry_secs} />
          </div>
          <div class="field">
            <label for="max-expiry">Longest lifetime (s){@render mark('max_expiry_secs')}</label>
            <input id="max-expiry" type="number" min="60" bind:value={form.max_expiry_secs} />
          </div>
          <div class="field">
            <label for="open">Open invoices cap{@render mark('max_open_invoices')}</label>
            <input id="open" type="number" min="1" bind:value={form.max_open_invoices} />
          </div>
          <div class="field">
            <label for="daily">Invoices per day cap{@render mark('max_invoices_per_day')}</label>
            <input id="daily" type="number" min="1" bind:value={form.max_invoices_per_day} />
            <p class="hint">Bounds how many addresses the public can use up.</p>
          </div>
          <div class="field">
            <label for="poll">Chain poll interval (s){@render mark('poll_secs')}</label>
            <input id="poll" type="number" min="1" max="3600" bind:value={form.poll_secs} />
          </div>
          <div class="field">
            <label for="grace">Late payment grace (s){@render mark('late_grace_secs')}</label>
            <input id="grace" type="number" min="0" bind:value={form.late_grace_secs} />
          </div>
        </div>
      </section>

      <!-- The sweep is not implemented yet: hidden until it is (its settings still round-trip). -->
      {#if showSweep}
        <section class="card" aria-labelledby="s-sweep">
          <h2 id="s-sweep">PayJoin / CoinJoin sweep</h2>
          <p class="hint">
            The policy for moving funds out once they pile up. This service holds no spending keys and never sends anything: a separate signer reads the policy
            and chooses the destination itself.
          </p>
          <div class="grid2">
            <div class="field">
              <label for="sweep-mode">Method</label>
              <select id="sweep-mode" bind:value={form.sweep.mode}>
                <option value="payjoin">PayJoin</option>
                <option value="coinjoin">CoinJoin</option>
              </select>
            </div>
            <div class="field">
              <label for="sweep-threshold">Threshold (sats)</label>
              <input id="sweep-threshold" type="number" min="10000" bind:value={form.sweep.threshold_sat} />
            </div>
            <div class="field">
              <label for="sweep-fee">Highest fee rate (sat/vB)</label>
              <input id="sweep-fee" type="number" min="1" max="1000" bind:value={form.sweep.max_fee_rate_sat_vb} />
            </div>
            <div class="field">
              <label for="sweep-anon">Smallest CoinJoin anonymity set</label>
              <input id="sweep-anon" type="number" min="2" max="1000" bind:value={form.sweep.min_anonymity_set} />
            </div>
          </div>
          <label class="check"><input id="sweep-on" type="checkbox" bind:checked={form.sweep.enabled} /> Enabled</label>
        </section>
      {/if}

      {#if section === 'general' && i2pProxy(form.proxies)}
        <I2pRegistries proxies={form.proxies} router={proxyName(i2pProxy(form.proxies)!)} />
      {/if}

      <section class="card host-only" aria-labelledby="s-host">
        <div class="card-head">
          <h2 id="s-host">Fixed on the host</h2>
          <span class="badge expired">host-only</span>
        </div>
        <p class="hint">Nothing that decides where money goes can be changed from here: the wallet key, network, Electrum server and data directory are set on the host.</p>
        <dl class="grid2 fixed">
          <div class="field"><dt>Network</dt><dd class="field-box">{view.fixed.network}</dd></div>
          <div class="field">
            <dt>Electrum server</dt>
            <dd class="field-box"><code>{view.fixed.electrum}</code> <span class="muted">{view.fixed.electrum_transport}</span></dd>
          </div>
          <div class="field"><dt>First receive address</dt><dd class="field-box"><code>{view.fixed.first_address}</code></dd></div>
          <div class="field"><dt>Discovery announcements</dt><dd class="field-box">{view.fixed.announce ? 'on' : 'off'}</dd></div>
        </dl>
      </section>
    {/if}

    <div class="save-bar">
      <div class="save-inner">
        {#if pending.count > 0}<span class="badge detected">{`${pending.count} change${pending.count === 1 ? '' : 's'}`}</span>{/if}
        <span class="save-text" class:failed={error !== ''}>
          {error !== ''
            ? `Not saved. ${error}`
            : pending.problem !== ''
            ? pending.problem
            : pending.count === 0
              ? 'No unsaved changes.'
              : pending.reconnects
                ? 'Relays or proxies changed: saving may reconnect the service.'
                : 'Saved as an override on top of the environment.'}
        </span>
        {#if view.overridden.length > 0}<span class="muted">* changed from the environment value</span>{/if}
        <button type="button" onclick={() => show(view!)} disabled={busy || (pending.count === 0 && pending.problem === '')}>Discard</button>
        <button class="primary" type="submit" disabled={busy}>Save changes</button>
      </div>
    </div>
  </form>

  <dialog class="replace-relay" bind:this={replaceDialog} aria-labelledby="replace-title" oncancel={closeReplace}>
    {#if replacing}
      {@const r = replacing}
      {@const listed = form.relays}
      <!-- Only the administration key can be left without a choice: this page's own relays are the only ones it may move to. -->
      {#if Object.keys(r.picks).some((k) => replacements(listed, r.url, k, dashboardRelays).length === 0)}
        <h2 id="replace-title"><span class="mono">{r.url}</span> cannot be removed</h2>
        <p class="replace-why">{`This page connects only through ${r.url}, so removing it would lock you out. Add another relay to this page's config.json first.`}</p>
        <div class="test-row">
          <button type="button" onclick={closeReplace}>Close</button>
        </div>
      {:else}
        <h2 id="replace-title">Replace <span class="mono">{r.url}</span></h2>
        {#each Object.keys(r.picks) as key (key)}
          <fieldset class="replace-key">
            <legend>
              {key === ADMIN && dashboardRelays.includes(r.url)
                ? `${keyLabel(key)} needs a relay that this page connects through. Choose which one takes over.`
                : `${keyLabel(key)} has no other relay. Choose which one takes over.`}
            </legend>
            {#each replacements(form.relays, r.url, key, dashboardRelays) as o (o)}
              <label class="replace-option">
                <input type="radio" name={`replace-${key}`} value={o} checked={r.picks[key] === o} onchange={() => (r.picks[key] = o)} />
                <span class="mono">{o}</span>
                {#if !form.relays.includes(o)}<span class="hint inline">not listed: it will be added</span>{/if}
              </label>
            {/each}
          </fieldset>
        {/each}
        <div class="test-row">
          <button type="button" class="primary" onclick={replaceAndRemove}>Replace and remove</button>
          <button type="button" onclick={closeReplace}>Keep the relay</button>
        </div>
      {/if}
    {/if}
  </dialog>
{/if}
