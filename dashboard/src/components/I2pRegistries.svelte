<script lang="ts">
  // The registries .i2p names are looked up in (when a relay is added by its
  // name). A setting of its own: it does not change how anything connects.
  import { MAX_REGISTRIES, registryProblem } from '../lib/proxy';
  import { registryHost } from '../lib/relays';
  import type { ProxySettings } from '../lib/schemas';

  let { proxies, router }: { proxies: ProxySettings; router: string } = $props();
  let newRegistry = $state('');
  let registryError = $state('');

  function addRegistry() {
    const t = newRegistry.trim();
    registryError = registryProblem(t, proxies.i2p_registries);
    if (registryError !== '') return;
    proxies.i2p_registries = [...proxies.i2p_registries, t];
    newRegistry = '';
  }

  function removeRegistry(r: string) {
    proxies.i2p_registries = proxies.i2p_registries.filter((x) => x !== r);
  }
</script>

<section class="card i2p-names" aria-labelledby="i2p-title">
  <h2 id="i2p-title">I2P names</h2>
  <p class="hint">
    {`When you add a relay by its .i2p name, the name is looked up once through ${router}, by asking these registries. The relay is saved under the .b32.i2p address it gets, so your router does not need to know the name.`}
  </p>
  <ul class="plain registry-list" aria-label="I2P name registries">
    {#each proxies.i2p_registries as r (r)}
      <li>
        <code class="mono">{r}</code>
        <button type="button" class="sm remove" aria-label={`Remove registry ${registryHost(r)}`} onclick={() => removeRegistry(r)}>Remove</button>
      </li>
    {:else}
      <li class="muted">No registries: names cannot be looked up.</li>
    {/each}
  </ul>
  {#if proxies.i2p_registries.length < MAX_REGISTRIES}
    <div class="add-relay">
      <label class="visually-hidden" for="registry">Add registry</label>
      <input
        id="registry"
        class="mono"
        placeholder="http://registry.i2p/jump?q={'{name}'}"
        aria-invalid={registryError !== ''}
        aria-describedby={registryError !== '' ? 'registry-error' : undefined}
        bind:value={newRegistry}
        oninput={() => (registryError = '')}
      />
      <button type="button" onclick={addRegistry}>Add</button>
    </div>
  {:else}
    <p class="hint">Four registries is the most.</p>
  {/if}
  {#if registryError !== ''}<p id="registry-error" class="field-error" role="alert">{registryError}</p>{/if}
</section>
