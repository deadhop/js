<script lang="ts">
  // The network settings of the signed-in service: read with get_network,
  // edited in the network views, saved with update_network (only what changed).
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import { ADMIN, assignmentProblem, dependents, relayKeysFor, relayKeysText, relayUsers, relaysOf, replacements, toggled } from '@deadhop/network-ui/lib/keys';
  import { proxiesPatch } from '@deadhop/network-ui/lib/proxy';
  import { rulesProblem } from '@deadhop/network-ui/lib/routes';
  import type { ConsoleApi, NetworkPatch } from '../lib/api';
  import type { NetworkSettings, NetworkView } from '../lib/schemas';
  import NetworkSection from './NetworkSection.svelte';

  let {
    api,
    pageRelays,
    networkView = 'routes',
    confirm = (message: string) => window.confirm(message),
  }: {
    api: ConsoleApi;
    /** Relays this page itself connects through. */
    pageRelays: string[];
    /** The view to open on. */
    networkView?: 'routes' | 'relays' | 'proxies' | 'rules';
    confirm?: (message: string) => boolean;
  } = $props();

  let view = $state<NetworkView | null>(null);
  let form = $state<NetworkSettings | null>(null);
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  function show(v: NetworkView) {
    view = v;
    form = structuredClone($state.snapshot(v.settings)) as NetworkSettings;
    error = '';
  }

  $effect(() => {
    api.getNetwork().then(show, (e: Error) => (error = e.message));
  });

  /** Names as saved: trimmed, empty ones left out, only for listed relays. */
  const cleanNames = (f: NetworkSettings) =>
    Object.fromEntries(
      Object.entries(f.relay_names)
        .map(([r, n]) => [r, n.trim()] as const)
        .filter(([r, n]) => n !== '' && f.relays.includes(r)),
    );
  const namesText = (m: Record<string, string>) => JSON.stringify(Object.entries(m).sort());

  /** Only the fields that differ from the live settings, or the problem with the form. */
  function diff(): NetworkPatch | string {
    const live = view!.settings;
    const f = form!;
    const patch: NetworkPatch = {};
    if (JSON.stringify(f.relays) !== JSON.stringify(live.relays)) patch.relays = [...f.relays];
    // Names only change what is shown: they never reconnect.
    const names = cleanNames(f);
    if (namesText(names) !== namesText(live.relay_names)) patch.relay_names = names;
    const problem = assignmentProblem(keys, f) || rulesProblem(f, keys, pageRelays);
    if (problem !== '') return problem;
    const assigned = relayKeysFor(f.relays, f.relay_keys, ids);
    if (relayKeysText(assigned) !== relayKeysText(relayKeysFor(live.relays, live.relay_keys, ids))) patch.relay_keys = assigned;
    const proxies = proxiesPatch(live.proxies, f.proxies);
    if (typeof proxies === 'string') return proxies;
    if (Object.keys(proxies).length > 0) patch.proxies = proxies;
    return patch;
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
    if (
      unreachable &&
      !confirm(`This page reaches the service through ${pageRelays.join(', ')}, and the administration key would no longer use any of them. This page loses access until the service goes back to its own relays (up to 10 minutes). Save anyway?`)
    ) {
      return;
    }
    if ((patch.relays || patch.relay_keys || patch.proxies) && !confirm('The service will reconnect to its relays, or switch proxy. If none connect, the change is undone automatically. Continue?')) {
      return;
    }
    busy = true;
    error = '';
    notice = '';
    try {
      show(await api.updateNetwork(patch));
      notice = 'Saved.';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  // Removing a relay that a key depends on first asks which relay takes over.
  let replacing = $state<{ url: string; picks: Record<string, string> } | null>(null);
  let replaceDialog = $state<HTMLDialogElement | null>(null);

  function removeRelay(url: string) {
    const needed = dependents(form!.relays, form!.relay_keys, url, ids, pageRelays);
    if (needed.length === 0) {
      dropRelay(url);
      return;
    }
    replacing = { url, picks: Object.fromEntries(needed.map((k) => [k, replacements(form!.relays, url, k, pageRelays)[0] ?? ''])) };
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

  const keys = $derived(view!.keys);
  const ids = $derived(keys.map((k) => k.id));
  // This page signs in through the administration key: it must keep one of the relays this page uses.
  const unreachable = $derived(form !== null && !pageRelays.some((r) => relaysOf(form!.relays, form!.relay_keys, ADMIN, ids).includes(r)));

  /** What the save bar says: a problem with the form, or how many settings would change. */
  const pending = $derived.by((): { count: number; problem: string; reconnects: boolean } => {
    const d = diff();
    if (typeof d === 'string') return { count: 0, problem: d, reconnects: false };
    return { count: Object.keys(d).length, problem: '', reconnects: d.relays !== undefined || d.relay_keys !== undefined || d.proxies !== undefined };
  });
</script>

<header class="page-head">
  <div>
    <p class="eyebrow">Network</p>
    <h1>How the service is reached</h1>
    <p class="muted">The relays each key listens on, and the proxies between them and the service. Saving reconnects; if nothing connects, the previous setup comes back.</p>
  </div>
  {#if view && view.overridden.length > 0}
    <div class="page-actions"><span class="badge detected">{`${view.overridden.length} overridden`}</span></div>
  {/if}
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if notice}<p class="note" role="status">{notice}</p>{/if}
{#if !view && !error}<Loading label="Loading the network settings" />{/if}

{#if view && form}
  {#each view.warnings as w (w)}<div class="warning" role="status"><span class="warning-text">{w}</span></div>{/each}
  {#if view.restart_pending}<p class="note" role="status">Reconnecting to the relays…</p>{/if}

  <form
    class="settings"
    onsubmit={(e) => {
      e.preventDefault();
      void save();
    }}
  >
    <NetworkSection {api} {view} bind:form bind:error {pageRelays} {networkView} {confirm} {removeRelay} {useRelay} />

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
        <button type="button" onclick={() => show(view!)} disabled={busy || (pending.count === 0 && pending.problem === '')}>Discard</button>
        <button class="primary" type="submit" disabled={busy}>Save changes</button>
      </div>
    </div>
  </form>

  <dialog class="replace-relay" bind:this={replaceDialog} aria-labelledby="replace-title" oncancel={closeReplace}>
    {#if replacing}
      {@const r = replacing}
      <!-- Only the administration key can be left without a choice: this page's own relays are the only ones it may move to. -->
      {#if Object.keys(r.picks).some((k) => replacements(form!.relays, r.url, k, pageRelays).length === 0)}
        <h2 id="replace-title"><span class="mono">{r.url}</span> cannot be removed</h2>
        <p class="replace-why">{`This page connects only through ${r.url}, so removing it would lock you out. Sign in again with another relay of the administration key first.`}</p>
        <div class="test-row">
          <button type="button" onclick={closeReplace}>Close</button>
        </div>
      {:else}
        <h2 id="replace-title">Replace <span class="mono">{r.url}</span></h2>
        {#each Object.keys(r.picks) as key (key)}
          <fieldset class="replace-key">
            <legend>
              {key === ADMIN && pageRelays.includes(r.url)
                ? `${keyLabel(key)} needs a relay that this page connects through. Choose which one takes over.`
                : `${keyLabel(key)} has no other relay. Choose which one takes over.`}
            </legend>
            {#each replacements(form.relays, r.url, key, pageRelays) as o (o)}
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
