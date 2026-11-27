<script lang="ts">
  // The setup page, shown while the service waits for its settings. It only
  // makes text: nothing typed here is sent to the service or anywhere else.
  import type { Nip07 } from '@deadhop/client';
  import { untrack } from 'svelte';
  import { nip19 } from 'nostr-tools';
  import { shortKey } from '@deadhop/network-ui/lib/format';
  import * as passkeys from '../lib/passkey';
  import {
    DEFAULT_POW_BITS,
    FORMATS,
    FORMAT_HINTS,
    FORMAT_LABELS,
    NETWORKS,
    accountKeyError,
    addOperator,
    electrumError,
    fileName,
    firstAddress,
    found,
    isLocal,
    isRelay,
    isTls,
    problems,
    render,
    settings,
    type Answers,
    type Format,
    type Network,
    type SetupStatus,
  } from '../lib/setup';

  let {
    status,
    defaultRelays = [],
    extension = () => (window as unknown as { nostr?: Nip07 }).nostr,
    passkey = passkeys,
    copy = (text: string) => navigator.clipboard.writeText(text),
    download = saveFile,
    host = location.host,
  }: {
    status: SetupStatus;
    defaultRelays?: string[];
    extension?: () => Nip07 | undefined;
    passkey?: Pick<typeof passkeys, 'support' | 'createPasskey' | 'usePasskey'>;
    copy?: (text: string) => Promise<void>;
    download?: (name: string, text: string) => void;
    host?: string;
  } = $props();

  function saveFile(name: string, text: string) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const STEPS = ['Network & wallet', 'Chain backend', 'Operators', 'Access & relays', 'Review & copy'];
  const NETWORK_LABELS: Record<Network, string> = { bitcoin: 'Mainnet', testnet: 'Testnet', signet: 'Signet', regtest: 'Regtest' };
  const SOURCE_LABELS = { pasted: 'Pasted', extension: 'Extension', passkey: 'Passkey' };

  // The answers start from what the service reported; later changes to the
  // props (there are none: the page reloads) would not reset them.
  const initial = untrack(() => ({ status, relays: defaultRelays }));
  const serviceWallet = found(initial.status, 'DEADHOP_XPUB');
  let step = $state(0);
  let a = $state<Answers>({
    network: initial.status.network,
    wallet: serviceWallet ? 'service' : 'own',
    xpub: '',
    electrum: '',
    fingerprint: '',
    operators: [],
    publicInvoicing: false,
    powBits: DEFAULT_POW_BITS,
    relays: [...initial.relays],
    name: '',
    proxy: '',
  });
  // The work chosen for public invoices (a select's value is text).
  let pow = $state(String(DEFAULT_POW_BITS));
  let pasted = $state('');
  let newRelay = $state('');
  let operatorError = $state('');
  let relayError = $state('');
  let passkeyLabel = $state('deadhop operator');
  let passkeyIds = $state<Record<string, Uint8Array>>({});
  let checked = $state<Record<string, string>>({});
  let busy = $state(false);
  let support = $state<passkeys.Support>('no');
  let format = $state<Format>('env');
  let copied = $state(false);

  $effect(() => {
    void passkey.support().then((s) => (support = s));
  });

  const answers = $derived({ ...a, powBits: Number(pow) });
  const todo = $derived(problems(answers));
  const stepTodo = (n: number) => todo.filter((p) => p.step === n);
  const pairs = $derived(settings(answers));
  const block = $derived(render(pairs, format));
  const keyError = $derived(a.wallet === 'own' && a.xpub.trim() !== '' ? accountKeyError(a.xpub, a.network) : '');
  const address = $derived(a.wallet === 'own' && a.xpub.trim() !== '' && keyError === '' ? firstAddress(a.xpub, a.network) : '');
  const chainError = $derived(a.electrum.trim() === '' ? '' : electrumError(a.electrum));
  const host_ = $derived(a.electrum.trim().replace(/^(tcp|tls|ssl):\/\//, ''));
  const npub = (hex: string) => shortKey(nip19.npubEncode(hex));

  function go(n: number) {
    step = n;
    copied = false;
    window.scrollTo(0, 0);
  }

  function pasteOperator(event: SubmitEvent) {
    event.preventDefault();
    const next = addOperator(a.operators, pasted, 'pasted');
    operatorError = next === null ? 'The key must be hex, npub or nprofile.' : '';
    if (next !== null) {
      a.operators = next;
      pasted = '';
    }
  }

  async function fromExtension() {
    operatorError = '';
    const ext = extension();
    if (!ext) {
      operatorError = 'No Nostr extension found in this browser.';
      return;
    }
    busy = true;
    try {
      const next = addOperator(a.operators, await ext.getPublicKey(), 'extension');
      if (next === null) throw new Error('The extension did not give a public key.');
      a.operators = next;
    } catch (e) {
      operatorError = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function newPasskey() {
    operatorError = '';
    busy = true;
    try {
      const key = await passkey.createPasskey(passkeyLabel.trim() || 'deadhop operator');
      a.operators = addOperator(a.operators, key.pubkey, 'passkey', passkeyLabel.trim())!;
      passkeyIds[key.pubkey] = key.id;
    } catch (e) {
      operatorError = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function testPasskey(pubkey: string) {
    busy = true;
    try {
      const key = await passkey.usePasskey(passkeyIds[pubkey]);
      checked[pubkey] = key.pubkey === pubkey ? 'Sign-in works.' : 'That passkey gives another key.';
    } catch (e) {
      checked[pubkey] = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function removeOperator(pubkey: string) {
    a.operators = a.operators.filter((o) => o.pubkey !== pubkey);
  }

  function addRelay(event: SubmitEvent) {
    event.preventDefault();
    const url = newRelay.trim();
    relayError = isRelay(url) ? '' : 'A relay is a ws:// or wss:// url.';
    if (relayError === '' && !a.relays.includes(url)) a.relays = [...a.relays, url];
    if (relayError === '') newRelay = '';
  }

  async function copyBlock() {
    await copy(block);
    copied = true;
  }

  const passkeyOperators = $derived(a.operators.filter((o) => o.source === 'passkey').length);
</script>

<div class="setup">
  <header class="site">
    <div class="bar">
      <span class="wordmark">deadhop</span>
      <span class="tag">SETUP</span>
      {#if step > 0}
        <ol class="steps" aria-label="Steps">
          {#each STEPS as label, i (label)}
            <li class={step === i + 1 ? 'now' : step > i + 1 ? 'done' : ''} aria-current={step === i + 1 ? 'step' : undefined}>
              {`${i + 1} ${label}`}
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  </header>

  <main class="setup-main">
    {#if step === 0}
      <section class="intro">
        <p class="eyebrow mono">SERVICE STATUS · NOT SET UP</p>
        <h1>This deadhop is waiting for its settings.</h1>
        <p class="lede">
          The service started without the settings it needs, so it is idle: no relay, no Electrum, no invoices. Answer a few questions and you get a
          block of settings to paste into your host. Nothing you type here leaves this browser.
        </p>
        <div class="card">
          <h2>What the service reported</h2>
          <dl class="reported">
            {#each status.settings as s (s.name)}
              <dt class="mono">{s.name}</dt>
              <dd>{s.about}</dd>
              <dd class={`state ${s.state}`}>{s.state}</dd>
            {/each}
          </dl>
        </div>
        <div class="row">
          <button class="primary" onclick={() => go(1)}>Start setup</button>
          <span class="muted">About 5 minutes. Have your Electrum server address ready.</span>
        </div>
        <p class="muted foot">
          Already have your settings? Set them on the host and restart the service; this page turns into the sign-in once it is serving. Its log lists
          what is still missing.
        </p>
      </section>
    {:else}
      <div class="cols">
        <section class="step">
          {#if step === 1}
            <h1>Network and wallet</h1>
            <fieldset>
              <legend>Bitcoin network</legend>
              <div class="choices">
                {#each NETWORKS as n (n)}
                  <label class={a.network === n ? 'choice on' : 'choice'}><input type="radio" name="network" value={`${n}`} bind:group={a.network} />{` ${NETWORK_LABELS[n]}`}</label>
                {/each}
              </div>
            </fieldset>
            <fieldset>
              <legend>Where payments land</legend>
              <label class={a.wallet === 'service' ? 'choice big on' : 'choice big'}>
                <input type="radio" name="wallet" value="service" bind:group={a.wallet} disabled={!serviceWallet} />
                <span>
                  <strong>Keep the wallet the wallet service made</strong>
                  {#if serviceWallet}
                    <span class="ok"> · found</span>
                    <span class="hint">No setting needed. Back up its recovery phrase before you take payments: <code>docker compose exec wallet deadhop wallet export</code></span>
                  {:else}
                    <span class="hint">The service found none. Start the wallet service (Docker Compose does), or use your own key.</span>
                  {/if}
                </span>
              </label>
              <label class={a.wallet === 'own' ? 'choice big on' : 'choice big'}>
                <input type="radio" name="wallet" value="own" bind:group={a.wallet} />
                <span>
                  <strong>Use my own wallet's account key</strong>
                  <span class="hint">xpub or zpub (tpub or vpub off mainnet). Watch-only: the service never sees a spending key.</span>
                </span>
              </label>
              {#if a.wallet === 'own'}
                <label for="xpub" class="visually-hidden">Account key</label>
                <input id="xpub" class="mono" spellcheck="false" autocomplete="off" placeholder="zpub6r…" bind:value={a.xpub} />
                {#if keyError}<p class="error" role="alert">{keyError}</p>{/if}
              {/if}
            </fieldset>
          {:else if step === 2}
            <h1>Chain backend</h1>
            <p class="lede">The Electrum server deadhop asks about your addresses. Run your own (Fulcrum, electrs) so nobody else learns which addresses are yours.</p>
            <label for="electrum">Electrum server</label>
            <input id="electrum" class="mono" spellcheck="false" autocomplete="off" placeholder="tls://electrum.example:50002" bind:value={a.electrum} />
            <p class="hint">host:port for plain TCP on this machine; tls://host:port for anything else.</p>
            {#if chainError}<p class="error" role="alert">{chainError}</p>{/if}
            {#if a.electrum.trim() !== '' && !chainError && !isTls(a.electrum) && !isLocal(a.electrum)}
              <p class="warn">Plain TCP to another machine: anyone on the way sees your addresses. Prefer tls:// with a pinned certificate.</p>
            {/if}
            {#if isTls(a.electrum)}
              <div class="card pin">
                <strong>Pin its certificate <span class="muted">(needed for a self-signed one)</span></strong>
                <p class="hint">This page cannot reach your Electrum server. Run this where the service runs and paste what it prints:</p>
                <pre class="cmd mono">{`docker compose run --rm deadhop fingerprint ${host_}`}</pre>
                <label for="fingerprint">SHA-256 fingerprint</label>
                <input id="fingerprint" class="mono" spellcheck="false" autocomplete="off" placeholder="64 hex characters" bind:value={a.fingerprint} />
              </div>
            {/if}
            {#each stepTodo(2) as p (p.text)}{#if a.electrum.trim() !== '' && p.text !== chainError}<p class="error">{p.text}</p>{/if}{/each}
            <p class="muted">Checked when the service starts: a wrong network or certificate stops it with a message naming this setting.</p>
          {:else if step === 3}
            <h1>Operators</h1>
            <p class="lede">The nostr keys allowed to run this service: create invoices, see the ledger, change settings. Only public keys go into the settings.</p>
            <div class="ways">
              <form class="card way" onsubmit={pasteOperator}>
                <strong>Paste a key</strong>
                <label for="pasted" class="hint">hex, npub or nprofile</label>
                <input id="pasted" class="mono" spellcheck="false" autocomplete="off" placeholder="npub1…" bind:value={pasted} />
                <button type="submit" disabled={pasted.trim() === ''}>Add</button>
              </form>
              <div class="card way">
                <strong>From a signer</strong>
                <span class="hint">Asks your extension for your public key only. Nothing is signed.</span>
                <button onclick={fromExtension} disabled={busy}>Browser extension</button>
              </div>
              <div class={support === 'no' ? 'card way' : 'card way pk'}>
                <strong>Create a passkey</strong>
                {#if support === 'no'}
                  <span class="hint">Not available in this browser: it needs https (or localhost) and a password manager with the PRF extension.</span>
                {:else}
                  <span class="hint">Your device makes the key; you sign in later with your fingerprint, face or PIN. It works only on this address: <span class="mono">{host}</span></span>
                  <label for="pk-label" class="hint">Name in your password manager</label>
                  <input id="pk-label" bind:value={passkeyLabel} />
                  <button class="primary" onclick={newPasskey} disabled={busy}>Create passkey</button>
                {/if}
              </div>
            </div>
            {#if operatorError}<p class="error" role="alert">{operatorError}</p>{/if}
            <h2>{`Added (${a.operators.length})`}</h2>
            {#if a.operators.length === 0}
              <p class="muted">None yet.</p>
            {:else}
              <ul class="ops">
                {#each a.operators as o (o.pubkey)}
                  <li>
                    <span class={`src ${o.source}`}>{SOURCE_LABELS[o.source]}</span>
                    <span class="grow"><span class="mono" title={o.pubkey}>{npub(o.pubkey)}</span>{#if o.label}<span class="muted">{` · ${o.label}`}</span>{/if}</span>
                    {#if checked[o.pubkey]}<span class="muted">{checked[o.pubkey]}</span>{/if}
                    {#if o.source === 'passkey'}<button class="sm" onclick={() => testPasskey(o.pubkey)} disabled={busy}>Test sign-in</button>{/if}
                    <button class="sm link bad" aria-label={`Remove ${npub(o.pubkey)}`} onclick={() => removeOperator(o.pubkey)}>Remove</button>
                  </li>
                {/each}
              </ul>
            {/if}
            {#if passkeyOperators > 0 && a.operators.length < 2}
              <p class="warn">A lost passkey is a lost operator: the key cannot be recovered or exported. Add a second operator (another passkey or a signer) before you finish.</p>
            {/if}
          {:else if step === 4}
            <h1>Access and relays</h1>
            <div class="card">
              <label class="check">
                <input type="checkbox" bind:checked={a.publicInvoicing} />
                <span><strong>Let anyone create invoices</strong><span class="hint">Needed for a checkout on your site. Each request costs the caller proof of work; operators skip it.</span></span>
              </label>
              {#if a.publicInvoicing}
                <label for="pow">Work per request</label>
                <select id="pow" bind:value={pow}>
                  <option value="16">16 bits · instant</option>
                  <option value="20">20 bits · about a second (default)</option>
                  <option value="24">24 bits · several seconds</option>
                </select>
              {/if}
            </div>
            <h2>Relays</h2>
            <p class="hint">The only way in or out of the service. You can change them later from the dashboard.</p>
            <ul class="relays">
              {#each a.relays as r (r)}
                <li><span class="mono grow">{r}</span><button class="sm link bad" aria-label={`Remove ${r}`} onclick={() => (a.relays = a.relays.filter((x) => x !== r))}>Remove</button></li>
              {/each}
            </ul>
            <form class="row" onsubmit={addRelay}>
              <label for="relay" class="visually-hidden">Add a relay</label>
              <input id="relay" class="mono grow" placeholder="wss://…" bind:value={newRelay} />
              <button type="submit" disabled={newRelay.trim() === ''}>Add</button>
            </form>
            {#if relayError}<p class="error" role="alert">{relayError}</p>{/if}
            <details>
              <summary>More: name and proxy</summary>
              <label for="name">Service name</label>
              <input id="name" placeholder="deadhop" bind:value={a.name} />
              <label for="proxy">SOCKS proxy for relays (Tor)</label>
              <input id="proxy" class="mono" placeholder="socks5h://127.0.0.1:9050" bind:value={a.proxy} />
              <p class="hint">Limits, confirmations and expiry keep their defaults: change them later from the dashboard's settings.</p>
            </details>
            {#each stepTodo(4) as p (p.text)}<p class="error">{p.text}</p>{/each}
          {:else}
            <h1>Your settings</h1>
            {#if todo.length > 0}
              <div class="card">
                <strong>Not finished yet</strong>
                <ul>
                  {#each todo as p (p.text)}<li><button class="link" onclick={() => go(p.step)}>{`${STEPS[p.step - 1]}`}</button>{`: ${p.text}`}</li>{/each}
                </ul>
              </div>
            {:else}
              <div class="tabs" role="tablist" aria-label="Format">
                {#each FORMATS as f (f)}
                  <button role="tab" aria-selected={format === f} class={format === f ? 'tab on' : 'tab'} onclick={() => ((format = f), (copied = false))}>{FORMAT_LABELS[f]}</button>
                {/each}
              </div>
              <p class="hint">{FORMAT_HINTS[format]}</p>
              <div class="block">
                <button class="copy" onclick={copyBlock}>{copied ? 'Copied' : 'Copy'}</button>
                <pre class="mono" data-testid="settings-block">{block}</pre>
              </div>
              <div class="row">
                <button onclick={() => download(fileName(format), block)}>Download {fileName(format)}</button>
                <span class="hint">Nothing here is a secret key. The Electrum address and the account key are private: share the block with care.</span>
              </div>
              <ol class="next">
                <li>Paste it where your host keeps environment variables.</li>
                <li>Restart the service. This page then shows the sign-in.</li>
                <li>Sign in with one of the operators you added.</li>
              </ol>
            {/if}
          {/if}

          <div class="row nav">
            <button onclick={() => go(step - 1)}>Back</button>
            {#if step < 5}
              <button class="primary" onclick={() => go(step + 1)} disabled={step === 1 && a.wallet === 'own' && (a.xpub.trim() === '' || keyError !== '')}
                >{step === 4 ? 'Review' : 'Continue'}</button
              >
            {/if}
          </div>
        </section>

        <aside class="side">
          {#if address}
            <div class="card">
              <strong>Check before going live</strong>
              <span class="hint">First receive address (index 0). Your wallet should list it:</span>
              <code class="mono addr">{address}</code>
            </div>
          {/if}
          <div class="card">
            <h2 class="mono small">SETTINGS SO FAR</h2>
            <pre class="mono so-far">{pairs
                .filter(([k]) => !(step < 2 && k === 'DEADHOP_ELECTRUM'))
                .filter(([k]) => step > 3 || k !== 'DEADHOP_RELAYS')
                .map(([k, v]) => `${k}=${v}`)
                .join('\n')}</pre>
            <p class="hint">Defaults are left out; the block stays short.</p>
          </div>
        </aside>
      </div>
    {/if}
  </main>
</div>

<style>
  .setup :global(header.site .bar) {
    gap: 0.75rem;
  }
  .tag {
    background: var(--tag);
    color: var(--tag-text);
    font-family: var(--mono);
    font-size: 0.7rem;
    padding: 0.2rem 0.5rem;
    border-radius: 4px;
  }
  .steps {
    margin: 0 0 0 auto;
    padding: 0;
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    gap: 1.25rem;
    font-size: 0.875rem;
    color: var(--muted);
  }
  .steps .now {
    color: var(--text);
    font-weight: 600;
    border-bottom: 2px solid var(--accent);
  }
  .steps .done {
    color: var(--ok);
  }
  .setup-main {
    max-width: var(--page);
    margin: 0 auto;
    padding: 2.5rem 1.5rem 6rem;
  }
  .intro {
    max-width: 48rem;
    margin: 1.5rem auto 0;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  .eyebrow {
    margin: 0;
    font-size: 0.75rem;
    color: var(--muted);
    letter-spacing: 0.04em;
  }
  h1 {
    margin: 0;
    font-family: var(--display);
    font-weight: 800;
    font-size: clamp(2rem, 4vw, 3rem);
    line-height: 1.05;
  }
  .step h1 {
    font-size: 2.25rem;
  }
  .lede {
    margin: 0;
    color: var(--soft);
    font-size: 1.1rem;
    max-width: 40rem;
  }
  .reported {
    display: grid;
    grid-template-columns: minmax(12rem, auto) 1fr auto;
    gap: 0.6rem 1rem;
    margin: 0.75rem 0 0;
    align-items: center;
  }
  .reported dt {
    font-size: 0.8rem;
  }
  .reported dd {
    margin: 0;
    color: var(--soft);
  }
  .state {
    font-weight: 600;
  }
  .state.missing {
    color: var(--bad) !important;
  }
  .state.found {
    color: var(--ok) !important;
  }
  .row {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .foot {
    border-top: 1.5px solid var(--line);
    padding-top: 1rem;
    margin: 0;
  }
  .cols {
    display: flex;
    flex-wrap: wrap;
    gap: 2.5rem;
  }
  .step {
    flex: 999 1 34rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .side {
    flex: 1 1 20rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  fieldset {
    border: 0;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  legend {
    font-weight: 600;
    margin-bottom: 0.6rem;
  }
  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
    gap: 0.6rem;
  }
  .choice {
    border: 1.5px solid var(--line);
    border-radius: 8px;
    padding: 0.75rem 0.9rem;
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    min-height: 44px;
  }
  .choice.on {
    border: 2px solid var(--text);
    background: var(--card);
  }
  .choice.big span {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .hint {
    font-size: 0.875rem;
    color: var(--muted);
  }
  .warn {
    color: var(--warn);
    font-size: 0.9rem;
    margin: 0;
  }
  .pin {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .cmd {
    margin: 0;
    background: #16191b;
    color: #e6ebe9;
    padding: 0.75rem 0.9rem;
    border-radius: 6px;
    font-size: 0.75rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .ways {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
    gap: 0.75rem;
  }
  .way {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin: 0;
  }
  .way.pk {
    border: 2px solid var(--accent);
  }
  .ops,
  .relays {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .ops li,
  .relays li {
    background: var(--card);
    border: 1.5px solid var(--line);
    border-radius: 8px;
    padding: 0.4rem 0.4rem 0.4rem 0.9rem;
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .grow {
    flex-grow: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .src {
    font-family: var(--mono);
    font-size: 0.7rem;
    text-transform: uppercase;
    padding: 0.15rem 0.5rem;
    border-radius: 4px;
    background: var(--soft);
    color: var(--card);
  }
  .src.passkey {
    background: var(--accent);
  }
  .check {
    display: flex;
    gap: 0.75rem;
    align-items: flex-start;
  }
  .check span {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  details summary {
    cursor: pointer;
    font-weight: 600;
    min-height: 44px;
    display: flex;
    align-items: center;
  }
  details[open] {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    border-bottom: 1.5px solid var(--line);
  }
  .tab {
    border: 0;
    border-bottom: 2.5px solid transparent;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    min-height: 44px;
  }
  .tab.on {
    color: var(--text);
    font-weight: 600;
    border-bottom-color: var(--accent);
  }
  .block {
    position: relative;
    background: #16191b;
    color: #e6ebe9;
    border-radius: 10px;
    padding: 1.25rem 1.4rem;
  }
  .block pre {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.75;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    padding-right: 5rem;
  }
  .copy {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
    background: #5fc6b9;
    color: #0e1214;
    border: 0;
    font-weight: 600;
  }
  .next {
    color: var(--soft);
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .nav {
    margin-top: 1.5rem;
  }
  .so-far {
    margin: 0;
    font-size: 0.75rem;
    line-height: 1.7;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .small {
    font-size: 0.8rem;
    font-weight: 500;
    color: var(--muted);
    margin: 0 0 0.5rem;
  }
  .addr {
    display: block;
    overflow-wrap: anywhere;
    margin-top: 0.5rem;
  }
  .side .card {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
</style>
