<script lang="ts">
  import { untrack } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { formatSats, formatTime, shortKey } from '@deadhop/network-ui/lib/format';
  import type { PayApi, UpdateInvoiceKeyInput } from '../lib/api';
  import type { Health, Info, InvoiceKeyInfo, InvoiceKeyList, KeyTotals } from '../lib/schemas';
  import { daysAgo, invoiceCount, npubOf, openCount, relayState, relayTone, totalsOf } from '../lib/invoicekeys';
  import { COLOR_NAMES, colorClass } from '../lib/keycolors';

  type NetworkView = 'routes' | 'relays';

  let {
    api,
    info,
    key,
    recent,
    health,
    now,
    copy,
    onBack,
    onLedger,
    onInvoices,
    onNetwork,
    onChanged,
    onArchived,
  }: {
    api: PayApi;
    info: Info;
    /** The key, with its totals of all time. */
    key: InvoiceKeyInfo;
    /** Its totals of the last 30 days. */
    recent: KeyTotals;
    health: Health;
    now: () => number;
    copy: (text: string) => Promise<void>;
    onBack: () => void;
    onLedger: () => void;
    onInvoices: () => void;
    onNetwork: (view: NetworkView) => void;
    onChanged: (list: InvoiceKeyList) => void | Promise<void>;
    onArchived: (list: InvoiceKeyList) => void | Promise<void>;
  } = $props();

  // The form starts from the key as it is now; saving reloads it.
  const start = untrack(() => key);
  let label = $state(start.label);
  let description = $state(start.description);
  let name = $state(start.name);
  let color = $state(start.color);
  let publicInvoicing = $state(start.public_invoicing);
  let announce = $state(start.announce);
  let confirmId = $state('');
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let copied = $state('');
  /** Today's invoices on this key and the service's daily cap; optional, so a failure leaves the tile out. */
  let cap = $state<{ today: number; max: number } | null>(null);

  $effect(() => {
    const id = key.id;
    Promise.all([api.listInvoiceKeys(daysAgo(now(), 1)), api.getSettings()]).then(
      ([day, view]) => (cap = { today: invoiceCount(totalsOf(day.keys, id)), max: view.settings.max_invoices_per_day }),
      () => (cap = null),
    );
  });

  const npub = $derived(npubOf(key.pubkey));
  const relays = $derived(relayState(health, key.id));
  // Read only once the key is loaded (an empty key has no nprofile).
  const nprofile = $derived(nip19.nprofileEncode({ pubkey: key.pubkey, relays: key.relays }));
  const snippet = $derived(
    `import { createDeadhop } from '@deadhop/client';\n\nconst deadhop = createDeadhop({\n  serverPubkey: '${npub}',\n  relays: [${key.relays.map((r) => `'${r}'`).join(', ')}],\n});`,
  );

  async function copyText(what: string, text: string) {
    try {
      await copy(text);
      copied = what;
    } catch {
      copied = '';
      error = 'Could not copy: select the text and copy it by hand.';
    }
  }

  async function save(event: SubmitEvent) {
    event.preventDefault();
    error = '';
    notice = '';
    if (label.trim() === '') {
      error = 'Give the key a name.';
      return;
    }
    // The original key's other settings are the service's own (Settings).
    const patch: UpdateInvoiceKeyInput = key.original
      ? { label: label.trim(), description: description.trim(), color }
      : { label: label.trim(), description: description.trim(), color, name: name.trim(), public_invoicing: publicInvoicing, announce };
    busy = true;
    try {
      await onChanged(await api.updateInvoiceKey(key.id, patch));
      notice = 'Saved.';
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function archive() {
    busy = true;
    error = '';
    try {
      await onArchived(await api.archiveInvoiceKey(key.id));
    } catch (e) {
      error = (e as Error).message;
      busy = false;
    }
  }
</script>

<header class="page-head">
  <div>
    <p class="eyebrow"><button class="link" onclick={onBack}>Keys</button>{` / ${key.id}`}</p>
    <h1 class="key-title"><span class={`swatch big ${colorClass(key.color)}`} aria-hidden="true"></span>{key.label}</h1>
    <p class="muted">
      {#if key.description !== ''}{`${key.description} · `}{/if}{key.original
        ? 'the original key'
        : `added ${formatTime(key.created_at)}${key.created_by === '' ? '' : ` by ${shortKey(npubOf(key.created_by))}`}`}
      · <span class={`dot inline ${relayTone(relays)}`} aria-hidden="true"></span>
      {`${relays.connected} of ${relays.urls.length} relays connected`}
    </p>
  </div>
  <button onclick={onInvoices}>Its invoices</button>
  <button onclick={onLedger}>Ledger</button>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if notice}<p class="note" role="status">{notice}</p>{/if}

<section class="tiles" aria-label="Figures">
  <div class="tile"><span class="lbl">Received · 30 d</span><span class="big">{formatSats(recent.confirmed_sat)}</span></div>
  <div class="tile"><span class="lbl">Paid invoices · 30 d</span><span class="big">{recent.confirmed}</span></div>
  <div class="tile"><span class="lbl">Open now</span><span class="big">{openCount(key.totals)}</span></div>
  {#if cap}
    <div class="tile">
      <span class="lbl">Of today’s cap</span><span class="big">{`${cap.today} / ${cap.max}`}</span><span class="note-line">shared by all keys</span>
    </div>
  {/if}
</section>

<div class="key-cols">
  <section class="card" aria-labelledby="kd-address">
    <h2 id="kd-address">Its address</h2>
    {#if key.pubkey === ''}
      <p class="muted">The service has not loaded this key yet.</p>
    {:else}
      <p class="hint">Give this to the service that uses it. Apps that already use another key do not change.</p>
      <dl class="key-ids">
        <dt>npub</dt>
        <dd><code class="key">{npub}</code><button class="sm" onclick={() => copyText('npub', npub)}>{copied === 'npub' ? 'Copied' : 'Copy'}</button></dd>
        <dt>hex</dt>
        <dd><code class="key">{key.pubkey}</code><button class="sm" onclick={() => copyText('hex', key.pubkey)}>{copied === 'hex' ? 'Copied' : 'Copy'}</button></dd>
        <dt>nprofile</dt>
        <dd>
          <code class="key" title={nprofile}>{`${nprofile.slice(0, 24)}… with ${key.relays.length} relay${key.relays.length === 1 ? '' : 's'}`}</code><button
            class="sm"
            onclick={() => copyText('nprofile', nprofile)}>{copied === 'nprofile' ? 'Copied' : 'Copy'}</button
          >
        </dd>
      </dl>
      <h3>In the app</h3>
      <pre class="snippet">{snippet}</pre>
      <button class="sm" onclick={() => copyText('snippet', snippet)}>{copied === 'snippet' ? 'Copied' : 'Copy code'}</button>
      <p class="hint">Nothing else changes for the app. It calls <code class="mono">create_invoice</code> and <code class="mono">get_invoice</code> exactly as today.</p>
    {/if}
  </section>

  <div class="key-side-stack">
    <form class="card key-form" aria-labelledby="kd-settings" onsubmit={save}>
      <h2 id="kd-settings">Settings</h2>
      <div class="field">
        <label for="kd-label">Name</label>
        <input id="kd-label" maxlength="40" autocomplete="off" bind:value={label} />
      </div>
      <div class="field">
        <label for="kd-desc">What it is for</label>
        <input id="kd-desc" maxlength="120" autocomplete="off" bind:value={description} />
      </div>
      <fieldset class="key-colors">
        <legend>Colour</legend>
        <div class="swatches">
          {#each COLOR_NAMES as c, i (c)}
            <button type="button" class={`swatch big ${colorClass(i)}`} class:on={color === i} aria-pressed={color === i} aria-label={c} onclick={() => (color = i)}></button>
          {/each}
        </div>
      </fieldset>
      {#if key.original}
        <p class="hint">Public invoicing, announcing and the name apps see are the service’s own settings for this key: change them under Settings.</p>
      {:else}
        <div class="field">
          <label for="kd-name">Name shown to apps</label>
          <input id="kd-name" maxlength="64" autocomplete="off" placeholder={`${info.name} (the service name)`} bind:value={name} />
          <span class="hint">What <code class="mono">get_info</code> and the announcement say on this key. Empty uses the service name.</span>
        </div>
        <label class="check">
          <input type="checkbox" bind:checked={publicInvoicing} />
          <span><strong>Anyone may create invoices</strong><br /><span class="hint">With proof of work and the service’s limits.</span></span>
        </label>
        <label class="check">
          <input type="checkbox" bind:checked={announce} />
          <span><strong>Announce it on the relays</strong><br /><span class="hint">Only when announcing is on for the service.</span></span>
        </label>
      {/if}
      <div class="row end"><button class="primary" type="submit" disabled={busy}>Save</button></div>
    </form>

    <section class="card" aria-labelledby="kd-relays">
      <div class="card-head">
        <h2 id="kd-relays">Relays and routes</h2>
        <button class="small" onclick={() => onNetwork('routes')}>Edit under Network</button>
      </div>
      {#if relays.urls.length === 0}
        <p class="muted">It uses no relay now.</p>
      {:else}
        <ul class="plain relay-list">
          {#each health.relays.filter((r) => r.keys.includes(key.id)) as r (r.url)}
            <li>
              <span class={`dot ${r.connected ? 'ok' : 'bad'}`} aria-hidden="true"></span>
              <span class="mono url">{r.url}</span>
              <span class={`badge ${r.connected ? 'confirmed' : 'expired'}`}>{r.status}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    {#if !key.original}
      <section class="card danger" aria-labelledby="kd-archive">
        <h2 id="kd-archive">Archive this key</h2>
        <p class="muted">
          It disconnects and stops answering, so the service that uses it can no longer create invoices. Its invoices stay in the ledger, and payments to open ones are still watched. You can restore it later with the same address.
        </p>
        <div class="row">
          <label for="kd-confirm" class="hint">Type <code class="mono">{key.id}</code> to confirm</label>
          <input id="kd-confirm" class="mono" autocomplete="off" bind:value={confirmId} />
          <button class="danger" disabled={busy || confirmId !== key.id} onclick={archive}>Archive</button>
        </div>
      </section>
    {/if}
  </div>
</div>
