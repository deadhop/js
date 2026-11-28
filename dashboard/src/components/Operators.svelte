<script lang="ts">
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import type { PayApi } from '../lib/api';
  import { normalizePubkey, type AuditLog, type SettingsView } from '../lib/schemas';
  import { formatTime, shortKey } from '@deadhop/network-ui/lib/format';
  import * as passkeys from '../lib/passkey';

  let {
    api,
    confirm = (message: string) => window.confirm(message),
    passkey = passkeys,
    host = location.host,
  }: {
    api: PayApi;
    confirm?: (message: string) => boolean;
    passkey?: Pick<typeof passkeys, 'support' | 'createPasskey' | 'usePasskey'>;
    host?: string;
  } = $props();

  let view = $state<SettingsView | null>(null);
  let audit = $state<AuditLog | null>(null);
  let newOperator = $state('');
  let newLabel = $state('');
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);
  let support = $state<passkeys.Support>('no');
  let passkeyLabel = $state('deadhop operator');

  async function load() {
    try {
      const [v, a] = await Promise.all([api.getSettings(), api.getAuditLog(50)]);
      view = v;
      audit = a;
    } catch (e) {
      error = (e as Error).message;
    }
  }

  $effect(() => {
    void load();
    void passkey.support().then((s) => (support = s));
  });

  async function run(action: () => Promise<SettingsView>, done: string) {
    busy = true;
    error = '';
    notice = '';
    try {
      view = await action();
      notice = done;
      audit = await api.getAuditLog(50);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function addOperator() {
    if (normalizePubkey(newOperator) === null) {
      error = 'The key must be hex, npub or nprofile.';
      return;
    }
    const key = newOperator.trim();
    const label = newLabel.trim();
    await run(() => api.addOperator(key, label), 'Operator added.');
    newOperator = '';
    newLabel = '';
  }

  // The passkey is asked for again before its key is added, so only a key
  // that this device can really sign in with becomes an operator.
  async function addPasskey() {
    const label = passkeyLabel.trim() || 'deadhop operator';
    busy = true;
    error = '';
    notice = '';
    let pubkey = '';
    try {
      const made = await passkey.createPasskey(label);
      const again = await passkey.usePasskey(made.id);
      if (again.pubkey !== made.pubkey) throw new Error('The passkey gave another key when asked again; nothing was added.');
      pubkey = made.pubkey;
    } catch (e) {
      error = (e as Error).message;
      busy = false;
      return;
    }
    await run(() => api.addOperator(pubkey, label), 'Passkey added. Sign in with it on this address only.');
  }

  async function removeOperator(pubkey: string) {
    if (!confirm(`Remove operator ${shortKey(pubkey)}? That key loses access immediately.`)) return;
    await run(() => api.removeOperator(pubkey), 'Operator removed.');
  }
</script>

<header class="page-head">
  <div>
    <p class="eyebrow">Operators</p>
    <h1>Who can run this service</h1>
    <p class="muted">An operator is a Nostr key. There are no accounts or passwords; every request is signed.</p>
  </div>
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if notice}<p class="note" role="status">{notice}</p>{/if}
{#if !view && !error}<Loading label="Loading operators" />{/if}

{#if view}
  <div class="split">
    <section class="card flush ops" aria-labelledby="op-title">
      <div class="card-head"><h2 id="op-title">Operators</h2></div>
      <div class="scroll">
        <table class="data">
          <thead><tr><th>Key</th><th>Label</th><th>Source</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
          <tbody>
            {#each view.operators as op (op.pubkey)}
              <tr>
                <td class="mono"><span title={op.pubkey}>{shortKey(op.pubkey)}</span></td>
                <td>{op.label}</td>
                <td><span class={op.source === 'dashboard' ? 'badge' : 'badge expired'}>{op.source === 'dashboard' ? 'dashboard' : 'from DEADHOP_ADMINS'}</span></td>
                <td class="num">
                  {#if op.source === 'dashboard'}
                    <button class="bad" onclick={() => removeOperator(op.pubkey)} disabled={busy} aria-label={`Remove operator ${op.pubkey}`}>Remove</button>
                  {:else}
                    <span class="hint inline">Remove on the host</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="hint pad">
        Keys from <span class="mono">DEADHOP_ADMINS</span> can only be removed on the host. Without any, the last dashboard operator cannot be removed: a service
        with no operator could never be managed again.
      </p>
    </section>

    <div class="add-col">
      <section class="card add-op" aria-labelledby="add-title">
        <h2 id="add-title">Add an operator</h2>
        <div class="field">
          <label for="op-key">Public key</label>
          <input id="op-key" class="mono" placeholder="npub1…, nprofile1… or hex" bind:value={newOperator} />
        </div>
        <div class="field">
          <label for="op-label">Label</label>
          <input id="op-label" placeholder="Who this is" bind:value={newLabel} maxlength="60" />
        </div>
        <button class="primary" onclick={addOperator} disabled={busy}>Add operator</button>
        <p class="hint">After a suspected compromise, check this list and the audit log: a stolen key can add keys to keep access.</p>
      </section>

      <section class="card add-op" aria-labelledby="pk-title">
        <h2 id="pk-title">Add a passkey</h2>
        {#if support === 'no'}
          <p class="hint">Not available in this browser: it needs https and a password manager with the PRF extension.</p>
        {:else}
          <p class="hint">
            Your device makes a new operator key; you sign in with your fingerprint, face or PIN. It works only on this address: <span class="mono">{host}</span>
          </p>
          <div class="field">
            <label for="pk-label">Name in your password manager</label>
            <input id="pk-label" bind:value={passkeyLabel} maxlength="60" />
          </div>
          <button class="primary" onclick={addPasskey} disabled={busy}>Create passkey</button>
          <p class="hint">A lost passkey is a lost operator: its key cannot be exported. Keep another operator.</p>
        {/if}
      </section>
    </div>
  </div>
{/if}

<section class="card flush" aria-labelledby="audit-title">
  <div class="card-head">
    <h2 id="audit-title">Audit log</h2>
    <span class="hint inline">Kept in the database; survives wipes. Proxy passwords are masked.</span>
  </div>
  {#if audit && audit.entries.length > 0}
    <div class="scroll">
      <table class="data">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
        <tbody>
          {#each audit.entries as e, i (i)}
            <tr>
              <td class="mono muted">{formatTime(e.at)}</td>
              <td class="mono" title={e.actor}>{e.actor === 'service' ? 'service' : shortKey(e.actor)}</td>
              <td><span class={e.actor === 'service' ? 'badge detected' : 'mono'}>{e.action}</span></td>
              <td class="detail">{e.detail}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="muted pad">No operator actions yet.</p>
  {/if}
</section>
