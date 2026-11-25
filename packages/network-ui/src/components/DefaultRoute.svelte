<script lang="ts">
  import { POLICIES, defaultFor, directEnd } from '../lib/routes';
  import type { Destination, KeyInfo, ProxySettings } from '../lib/schemas';
  import DestinationPicker from './DestinationPicker.svelte';

  // The default route, the last rule: where relays that no rule matches go,
  // for every key and, where set, for one key. It changes the form in place.
  let {
    keys,
    proxies,
    ondone,
    onproxies,
  }: {
    keys: KeyInfo[];
    /** The form's proxy settings (changed in place). */
    proxies: ProxySettings;
    ondone: () => void;
    /** Open the Proxies view (where the offline policy is). */
    onproxies: () => void;
  } = $props();

  const policy = $derived(POLICIES.find((p) => p.value === proxies.offline)!);
  /** How the default route of each key can end in a direct connection, once per distinct sentence. */
  const straight = $derived([...new Set(keys.map((k) => directEnd(defaultFor(proxies, k.id), 'policy', proxies.offline, proxies)).filter((t) => t !== ''))]);

  const blocked = $derived(keys.filter((k) => defaultFor(proxies, k.id) === 'block').map((k) => k.label));

  function override(id: string, on: boolean) {
    const { [id]: _old, ...rest } = proxies.default_keys;
    proxies.default_keys = on ? { ...rest, [id]: proxies.default } : rest;
  }
  const setKey = (id: string, d: Destination) => (proxies.default_keys = { ...proxies.default_keys, [id]: d });
</script>

<section class="card rule-editor" aria-labelledby="default-editor-title">
  <h3 id="default-editor-title">Everything else: the default route</h3>
  <p class="hint">Where relays go that no rule above matches. It is always the last rule.</p>
  <div class="rule-grid">
    <div class="rule-fields">
      <fieldset class="rule-step">
        <legend>For every key</legend>
        <DestinationPicker name="default-to" label="Everything else goes" {proxies} value={proxies.default} onpick={(d) => (proxies.default = d)} />
      </fieldset>
      {#each keys as k (k.id)}
        {@const own = proxies.default_keys[k.id]}
        <fieldset class="rule-step">
          <legend>{`For the ${k.label} key`}</legend>
          <label class="check"><input type="checkbox" checked={own !== undefined} onchange={(e) => override(k.id, e.currentTarget.checked)} /> A different default route for this key</label>
          {#if own !== undefined}
            <DestinationPicker name={`default-${k.id}`} label={`Everything else goes, for ${k.label}`} {proxies} value={own} onpick={(d) => setKey(k.id, d)} />
          {/if}
        </fieldset>
      {/each}
    </div>
    <aside class="rule-preview" aria-label="If the default route has nothing reachable">
      <b>If it has nothing reachable</b>
      <span>{`The offline policy decides: now ${policy.title}. ${policy.text}`}</span>
      {#each straight as t (t)}
        <p class="map-alert warn" role="status">{t}</p>
      {/each}
      {#if blocked.length > 0}
        <span class="hint">{`Blocked for ${blocked.join(', ')}: only the relays a rule sends somewhere connect.`}</span>
      {/if}
      <div class="test-row">
        <button type="button" class="primary" onclick={ondone}>Done</button>
        <button type="button" onclick={onproxies}>Change the offline policy</button>
      </div>
      <span class="hint">This changes the form only. Nothing reconnects until "Save changes".</span>
    </aside>
  </div>
</section>
