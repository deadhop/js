<script lang="ts">
  import { untrack } from 'svelte';
  import type { PayApi } from '../lib/api';
  import type { InvoiceKeyInfo, InvoiceKeyList } from '../lib/schemas';
  import { freeColor, idProblem, inUse, suggestId } from '../lib/invoicekeys';
  import { COLOR_NAMES, colorClass } from '../lib/keycolors';
  import KeyChip from './KeyChip.svelte';

  let {
    api,
    keys,
    onCancel,
    onAdded,
  }: {
    api: PayApi;
    /** Every invoice key, archived ones included (their ids stay taken). */
    keys: InvoiceKeyInfo[];
    onCancel: () => void;
    onAdded: (list: InvoiceKeyList, id: string) => void | Promise<void>;
  } = $props();

  let label = $state('');
  let id = $state('');
  /** Whether the id was typed: then a new name no longer changes it. */
  let ownId = $state(false);
  let description = $state('');
  let color = $state(untrack(() => freeColor(keys)));
  let from = $state('invoices');
  let publicInvoicing = $state(true);
  let announce = $state(false);
  let busy = $state(false);
  let error = $state('');
  let tried = $state(false);

  const live = $derived(inUse(keys));
  const problem = $derived(idProblem(id, keys.map((k) => k.id)));
  /** Who uses each colour now, for the swatches' names. */
  const users = $derived(Object.fromEntries(live.map((k) => [k.color, k.label])));

  function rename(value: string) {
    label = value;
    if (!ownId) id = suggestId(value);
  }

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    if (label.trim() === '') {
      error = 'Give the key a name.';
      return;
    }
    tried = true;
    if (problem !== '') return;
    busy = true;
    try {
      const text = description.trim();
      const list = await api.addInvoiceKey({
        id,
        label: label.trim(),
        ...(text === '' ? {} : { description: text }),
        color,
        public_invoicing: publicInvoicing,
        announce,
        copy_from: from,
      });
      await onAdded(list, id);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }
</script>

<header class="page-head">
  <div>
    <p class="eyebrow"><button class="link" onclick={onCancel}>Keys</button> / new</p>
    <h1>Add an invoice key</h1>
  </div>
</header>

<div class="split">
  <form class="card key-form" aria-label="New invoice key" onsubmit={submit}>
    <div class="grid2">
      <div class="field">
        <label for="key-label">Name</label>
        <input id="key-label" maxlength="40" autocomplete="off" value={label} oninput={(e) => rename(e.currentTarget.value)} />
        <span class="hint">What you call this service. You can change it later.</span>
      </div>
      <div class="field">
        <label for="key-id">Id</label>
        <input
          id="key-id"
          class="mono"
          maxlength="24"
          autocomplete="off"
          value={id}
          aria-invalid={tried && problem !== ''}
          oninput={(e) => {
            id = e.currentTarget.value;
            ownId = true;
          }}
        />
        <span class="hint">Lower-case letters, digits and dashes. It is permanent: settings, rules and exports refer to the key by it.</span>
        {#if tried && problem !== ''}<span class="field-error" role="alert">{problem}</span>{/if}
      </div>
    </div>
    <div class="field">
      <label for="key-desc">What it is for <span class="hint inline">(optional)</span></label>
      <input id="key-desc" maxlength="120" autocomplete="off" bind:value={description} />
    </div>
    <fieldset class="key-colors">
      <legend>Colour</legend>
      <div class="swatches">
        {#each COLOR_NAMES as name, i (name)}
          <button
            type="button"
            class={`swatch big ${colorClass(i)}`}
            class:on={color === i}
            aria-pressed={color === i}
            aria-label={i in users ? `${name} (${users[i]} uses it)` : name}
            onclick={() => (color = i)}
          ></button>
        {/each}
      </div>
      <span class="hint">Only used on this dashboard, to tell keys apart in tables and charts.</span>
    </fieldset>
    <fieldset>
      <legend>Start its relays and routes from</legend>
      <div class="options">
        {#each live as k (k.id)}
          <label class="option" class:on={from === k.id}>
            <input type="radio" name="copy-from" value={`${k.id}`} bind:group={from} />
            <span><KeyChip label={k.label} color={k.color} /><br /><span class="hint">Same relays, same proxy rules and default route. You can change them afterwards under Network.</span></span>
          </label>
        {/each}
        <label class="option" class:on={from === ''}>
          <input type="radio" name="copy-from" value="" bind:group={from} />
          <span><strong>Every relay, service default route</strong><br /><span class="hint">Uses the relays and rules set for all keys only.</span></span>
        </label>
      </div>
    </fieldset>
    <label class="check">
      <input type="checkbox" bind:checked={publicInvoicing} />
      <span><strong>Anyone may create invoices on it</strong><br /><span class="hint">Like the service-wide setting, with proof of work and the same limits. Switch it off for a key only your own backend uses (operators only).</span></span>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={announce} />
      <span><strong>Announce it on the relays</strong><br /><span class="hint">Lists this key as a ContextVM server so others can find it. Off keeps it known only to the apps you give it to.</span></span>
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="row end">
      <button type="button" onclick={onCancel}>Cancel</button>
      <button class="primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
    </div>
  </form>

  <aside class="card key-side">
    <h2>What happens</h2>
    <ol>
      <li>The server makes a new nostr key and keeps its secret in the data directory, next to the others.</li>
      <li>It connects that key to its relays. The other keys stay connected.</li>
      <li>You get its npub to put in that service’s checkout: <code class="mono">{'createDeadhop({ serverPubkey: "npub1…" })'}</code>.</li>
    </ol>
    <p class="hint">Invoices it takes come from the same wallet as all others: one xpub, one address sequence. The key only decides whose ledger they go in.</p>
  </aside>
</div>
