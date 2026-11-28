<script lang="ts">
  import Loading from '@deadhop/network-ui/components/Loading.svelte';
  import { poll } from '@deadhop/network-ui/lib/poll';
  import type { ControlAction, PayApi } from '../lib/api';
  import type { AdminInvoice, Health, InvoiceKeyList, Metrics, PrivacyAudit, Range, RelayHistory, Series } from '../lib/schemas';
  import { cutOff, daysAgo, invoiceCount, listUrls, nowSecs, npubOf, openCount, percent, relayState, relayTone, shortNpub, totalsOf } from '../lib/invoicekeys';
  import KeyChip from './KeyChip.svelte';
  import { statusLabel } from '@deadhop/network-ui/lib/format';
  import { dropId, formatBtc, formatBytes, formatDuration, formatSats, formatTime } from '@deadhop/network-ui/lib/format';
  import { defaultGroup } from '@deadhop/network-ui/lib/routeview';
  import Chart from './Chart.svelte';
  import Relays from './relays/Relays.svelte';
  import ServiceKey from './ServiceKey.svelte';
  import Warnings from './Warnings.svelte';

  let {
    api,
    serverPubkey,
    adminPubkey,
    refreshMs = 15000,
    onAudit,
    onDrops,
    onConnectivity,
    onKeys,
    onRelays,
    now = nowSecs,
    copy = (text: string) => navigator.clipboard.writeText(text),
    confirm = (message: string) => window.confirm(message),
  }: {
    api: PayApi;
    serverPubkey: string;
    adminPubkey: string;
    refreshMs?: number;
    onAudit: () => void;
    onDrops: () => void;
    onConnectivity: () => void;
    /** Open the Keys tab. */
    onKeys: () => void;
    /** Open the Network tab on its relays. */
    onRelays: () => void;
    now?: () => number;
    copy?: (text: string) => Promise<void>;
    confirm?: (message: string) => boolean;
  } = $props();

  // The keys' public keys come from the service; the page's config covers the moment before it says.
  const keyOf = (h: Health, id: string, fallback: string) => h.keys.find((k) => k.id === id)?.pubkey || fallback;

  // The audit is optional on this page: if it fails, the tile is left out.
  let audit = $state<PrivacyAudit | null>(null);
  // Recent drops are optional on this page too.
  let recent = $state<AdminInvoice[]>([]);
  // Each row's key is asked for only once there are keys to tell apart: a
  // service without invoice keys does not know the argument.
  $effect(() => {
    const keyed = several;
    Promise.resolve()
      .then(() => api.listInvoices(keyed ? { with_key: true } : {}))
      .then(
        (page) => (recent = page.invoices.slice(0, 5)),
        () => (recent = []),
      );
  });
  $effect(() => {
    api.getPrivacyAudit().then(
      (a) => (audit = a),
      () => (audit = null),
    );
  });

  let data = $state<{ health: Health; metrics: Metrics; series: Series } | null>(null);
  // A day of relay results; optional here, so a failure just leaves it out.
  let history = $state<RelayHistory | null>(null);
  let range = $state<Range>('week');
  /** The invoice keys, with their totals of all time and of the last 30 days; optional, so a failure leaves the figures out. */
  let keyLists = $state<{ all: InvoiceKeyList; recent: InvoiceKeyList } | null>(null);
  /** Whose takings the totals and the chart show: '' is every key. */
  let takings = $state('');
  let copied = $state('');
  let metric = $state<'sat' | 'count'>('sat');
  let error = $state('');
  let notice = $state('');
  let busy = $state(false);

  const RANGES: { value: Range; label: string }[] = [
    { value: 'day', label: '24 hours' },
    { value: 'week', label: '7 days' },
    { value: 'month', label: '30 days' },
    { value: 'year', label: '1 year' },
  ];
  const TRANSPORT: Record<Health['chain']['transport'], string> = {
    tcp: 'plain TCP',
    tls: 'TLS (public authorities)',
    'tls-pinned': 'TLS, pinned certificate',
  };
  const WINDOW_LABELS: Record<string, string> = { '24h': 'Last 24 hours', '7d': 'Last 7 days', '30d': 'Last 30 days', '365d': 'Last year' };
  const MESSAGES: Record<ControlAction, string> = {
    stop: 'Invoicing stopped. Payments to existing invoices are still watched.',
    start: 'Invoicing started.',
    restart: 'Reconnecting to the relays. This page may need a few seconds to get answers again.',
  };
  let checking = $state(false);

  async function checkRelays() {
    checking = true;
    try {
      await api.checkRelays();
      await load(range, takings);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      checking = false;
    }
  }

  /** Length of the score ring (radius 34). */
  const RING = 2 * Math.PI * 34;

  /** A call this page can do without: its failure is null. */
  const optional = <T,>(call: () => Promise<T>): Promise<T | null> =>
    Promise.resolve()
      .then(call)
      .then(
        (v) => v,
        () => null,
      );

  async function load(which: Range, key: string) {
    try {
      const [health, metrics, series, day, all, recent] = await Promise.all([
        api.getHealth(),
        api.getMetrics(),
        key === '' ? api.getSeries(which) : api.getSeries(which, key),
        optional(() => api.getRelayHistory('1d')),
        optional(() => api.listInvoiceKeys()),
        optional(() => api.listInvoiceKeys(daysAgo(now(), 30))),
      ]);
      data = { health, metrics, series };
      history = day;
      keyLists = all === null || recent === null ? null : { all, recent };
      error = '';
    } catch (e) {
      error = (e as Error).message;
    }
  }

  // Runs on mount and whenever the chart range or the key changes.
  $effect(() => {
    const which = range;
    const key = takings;
    return poll(() => load(which, key), refreshMs);
  });

  /** Whether there is more than one invoice key to tell apart (archived ones included). */
  const several = $derived(keyLists !== null && keyLists.all.keys.length > 1);

  /** The invoice keys in use, one row each: from health, with the figures when the key list loaded. */
  function keyRows(h: Health, lists: typeof keyLists) {
    const keys = h.keys.filter((k) => !k.operators_only);
    const recent = lists === null ? [] : lists.recent.keys;
    const total = recent.reduce((a, k) => a + k.totals.confirmed_sat, 0);
    return keys.map((k, i) => {
      const stored = lists?.all.keys.find((x) => x.id === k.id);
      const received = totalsOf(recent, k.id).confirmed_sat;
      return {
        id: k.id,
        label: k.label,
        color: stored === undefined ? i : stored.color,
        pubkey: k.id === 'invoices' ? keyOf(h, 'invoices', serverPubkey) : k.pubkey,
        relays: relayState(h, k.id),
        open: stored === undefined ? '—' : String(openCount(stored.totals)),
        received: lists === null ? '—' : formatSats(received),
        share: percent(received, total),
      };
    });
  }

  /** The key a drop came in on, as a chip (label and colour), or null when the list does not say. */
  function dropKey(id: string | undefined) {
    const k = keyLists!.all.keys.find((x) => x.id === id);
    return k === undefined ? null : { label: k.label, color: k.color, archived: k.archived_at !== null };
  }

  async function copyNpub(id: string, hex: string) {
    try {
      await copy(npubOf(hex));
      copied = id;
    } catch {
      copied = '';
      error = 'Could not copy: select the key and copy it by hand.';
    }
  }

  async function control(action: ControlAction) {
    if (action === 'stop' && !confirm('Stop accepting new invoices? Existing invoices keep being watched.')) return;
    busy = true;
    notice = '';
    try {
      await api.control(action);
      notice = MESSAGES[action];
      await load(range, takings);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function tone(score: number): string {
    return score >= 90 ? 'ok' : score >= 60 ? 'warn' : 'bad';
  }

  function fixes(a: PrivacyAudit): string {
    const n = a.checks.filter((c) => c.result === 'fail' || c.result === 'to_fix').length;
    return n === 0 ? 'Nothing to fix' : `${n} thing${n === 1 ? '' : 's'} to fix`;
  }

  function heading(d: typeof data, failed: string): string {
    if (d === null) return failed ? 'Not loaded.' : 'Loading…';
    return d.health.service.paused ? 'Invoicing stopped.' : 'Serving. Dials out, never listens.';
  }

  /** What the proxy tile says, from the default route, the live relay states and the last check. */
  function proxyTile(h: Health) {
    const pool = h.proxy_pool;
    const connected = h.relays.filter((r) => r.connected).length;
    const named = (id: string) => {
      const p = pool.proxies.find((x) => x.id === id);
      return p === undefined ? id : p.name === '' ? p.url : p.name;
    };
    const d = pool.default;
    /** The default route, in words. */
    const route = d === 'direct' || d === 'block' ? d : 'proxy' in d ? named(d.proxy) : `group ${d.group}`;
    if (pool.state === 'transparent') {
      return {
        stamp: 'declared',
        stampClass: 'badge detected',
        title: 'Transparent proxy',
        tone: 'soft',
        line: 'declared by the operator',
        text: 'Not checked: the operator runs a transparent proxy around this service, and the proxy list is not used.',
      };
    }
    if (pool.state === 'direct') {
      return {
        stamp: 'none',
        stampClass: 'badge to_fix',
        title: pool.total === 0 ? 'None' : 'Direct',
        tone: 'warn',
        line: pool.total === 0 ? 'direct' : 'default route: direct',
        text: pool.total === 0 ? 'Relays connect straight to this machine and can see its IP address.' : 'Relays that no rule sends through a proxy connect straight to this machine and can see its IP address.',
      };
    }
    if (pool.state === 'blocked') {
      return {
        stamp: 'rules only',
        stampClass: 'badge detected',
        title: 'Rules only',
        tone: 'soft',
        line: 'default route: block',
        text: 'Relays that no rule matches are not connected. The rules decide where the others go.',
      };
    }
    if (pool.state === 'offline') {
      const what: Record<Health['proxy_pool']['posture'], string> = {
        off: 'Kill switch: the relays on the default route are disconnected until it is back.',
        admin_only: 'Relays connect straight, and only operators are served.',
        invoicing_only: 'Relays connect straight, and only invoicing is served.',
        open: 'Relays connect straight and everything is served.',
        normal: '',
      };
      return {
        stamp: 'offline',
        stampClass: 'badge fail',
        title: typeof d === 'object' && 'group' in d ? `No proxy in ${route} reachable` : `${route} down`,
        tone: 'bad',
        line: `default route: ${route}`,
        text: what[pool.posture],
      };
    }
    const label = pool.active === null ? 'no proxy' : named(pool.active);
    const check = h.proxy_check;
    const via = typeof d === 'object' && 'group' in d ? `${route}: ${label}` : label;
    const line = `${via} · ${check === null ? h.proxy : `${h.proxy} · last check ${check.status}`}`;
    const checked = check === null ? 'Not checked yet.' : `Checked ${formatTime(check.checked_at)}.`;
    // Only a group switches; the soonest switch of any group may be a rule's.
    const switchAt = defaultGroup(pool)?.next_switch_at ?? null;
    const next = switchAt === null ? '' : ` Next switch ${formatTime(switchAt)}.`;
    if (pool.state === 'suspended') {
      return {
        stamp: 'suspended',
        stampClass: 'badge not_checked',
        title: 'Rotation suspended',
        tone: 'warn',
        line,
        text: `Only ${pool.reachable} proxy in ${route} is reachable, so it is not rotating; ${label} keeps carrying traffic. ${checked}`,
      };
    }
    if (connected === 0) {
      return { stamp: 'offline', stampClass: 'badge fail', title: 'Not connected', tone: 'bad', line, text: `No relay is connected through it. ${checked}${next}` };
    }
    const timed = check?.relays.find((r) => r.ok && r.ms !== null);
    return {
      stamp: 'online',
      stampClass: 'badge confirmed',
      title: timed ? `Reachable · ${timed.ms} ms` : 'Reachable',
      tone: 'ok',
      line,
      text: `${connected} of ${h.relays.length} relays through it: they see the proxy, not this machine. ${checked}${next}`,
    };
  }
</script>

<header class="page-head">
  <div>
    <p class="eyebrow">Overview</p>
    <h1>{heading(data, error)}</h1>
  </div>
  {#if data}
    <button onclick={() => control('restart')} disabled={busy}>Restart relays</button>
    {#if data.health.service.paused}
      <button class="primary" onclick={() => control('start')} disabled={busy}>Start invoicing</button>
    {:else}
      <button onclick={() => control('stop')} disabled={busy}>Stop invoicing</button>
    {/if}
  {/if}
</header>

{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if notice}<p class="note" role="status">{notice}</p>{/if}
{#if data === null && !error}<Loading label="Loading the overview" />{/if}

{#if data}
  {@const { health, metrics, series } = data}
  {@const connected = health.relays.filter((r) => r.connected).length}
  {@const proxy = proxyTile(health)}
  <Warnings warnings={health.warnings} />
  {#each cutOff(health) as k (k.id)}
    <div class="warning key-alert" role="alert">
      <div>
        <strong>{`${k.label} has no relay connected.`}</strong>
        <span
          >{k.urls.length === 0
            ? 'It has no relay at all. Apps cannot reach that key right now. The other keys are not affected.'
            : `${k.urls.length === 1 ? 'Its only relay' : 'Its relays'}, ${listUrls(k.urls)}, ${k.urls.length === 1 ? 'is' : 'are'} not connected. Apps cannot reach that key right now. The other keys are not affected.`}</span
        >
      </div>
      <button onclick={onRelays}>Give it another relay</button>
    </div>
  {/each}

  <section class="tiles wide" aria-label="Privacy and proxy">
    {#if audit}
      <button class="tile score-tile" onclick={onAudit} aria-label={`Privacy score ${audit.score} out of 100. Open the privacy audit`}>
        <svg class={`ring small ${tone(audit.score)}`} viewBox="0 0 84 84" aria-hidden="true">
          <circle class="track" cx="42" cy="42" r="34" />
          <circle class="value" cx="42" cy="42" r="34" stroke-dasharray={`${(audit.score / 100) * RING} ${RING}`} transform="rotate(-90 42 42)" />
          <text x="42" y="50" text-anchor="middle">{audit.score}</text>
        </svg>
        <span class="tile-body">
          <span class="lbl">Privacy score</span>
          <span class={`big ${tone(audit.score)}`}>{fixes(audit)}</span>
          <span class="note-line">{`${audit.checked} of ${audit.total} checks could run here.`}</span>
          <span class="go">Open the audit →</span>
        </span>
      </button>
    {/if}
    <div class="tile">
      <div class="tile-top">
        <span class="lbl">Proxy</span>
        <span class={proxy.stampClass}>{proxy.stamp}</span>
      </div>
      <span class={`big ${proxy.tone}`}>{proxy.title}</span>
      <span class="mono soft">{proxy.line}</span>
      <span class="note-line">{proxy.text}</span>
    </div>
  </section>

  <section class="tiles" aria-label="Health">
    <div class="tile">
      <span class="lbl">Service</span>
      <span class={`big ${health.service.paused ? 'bad' : 'ok'}`}>{health.service.paused ? 'Invoicing stopped' : 'Running'}</span>
      <span class="note-line"
        >{`up ${formatDuration(health.service.uptime_secs)} · v${health.service.version} · ${health.service.restarts} restart${health.service.restarts === 1 ? '' : 's'}${health.service.restart_pending ? ' · restarting…' : ''}`}</span
      >
    </div>
    <div class="tile">
      <span class="lbl">Relays</span>
      <span class={`big ${connected > 0 ? 'ok' : 'bad'}`}>{`${connected} of ${health.relays.length} connected`}</span>
      <span class="note-line">{health.proxy === '' ? (health.proxy_pool.state === 'transparent' ? 'through your transparent proxy' : 'direct connection') : 'through the proxy'}</span>
    </div>
    <div class="tile">
      <span class="lbl">Chain</span>
      <span class={`big ${health.chain.ok ? 'ok' : 'bad'}`}
        >{health.chain.ok ? (health.chain.tip_height === null ? 'Connected' : `Block ${health.chain.tip_height.toLocaleString('en-US')}`) : 'Unreachable'}</span
      >
      <span class="note-line"
        >{`${TRANSPORT[health.chain.transport]} · ${health.chain.last_poll_at === null ? 'not polled yet' : `polled ${formatTime(health.chain.last_poll_at)}`}`}</span
      >
    </div>
    <div class="tile">
      <span class="lbl">Database</span>
      <span class={`big ${health.database.ok ? 'ok' : 'bad'}`}>{health.database.ok ? 'Healthy' : 'Integrity check failed'}</span>
      <span class="note-line"
        >{`${formatBytes(health.database.size_bytes)} · ${health.database.last_backup_at === null ? 'never backed up' : `backed up ${formatTime(health.database.last_backup_at)}`}`}</span
      >
    </div>
  </section>

  <section class="card" aria-labelledby="o-relays">
    <Relays {health} {history} {checking} oncheck={checkRelays} {onConnectivity} />
    {#if health.chain.watch_errors > 0}
      <p class="error">{`${health.chain.watch_errors} invoice${health.chain.watch_errors === 1 ? '' : 's'} could not be read from the chain.`}</p>
    {/if}
    {#if !health.chain.backend_local}
      <p class="hint">The Electrum server is not on this machine.</p>
    {/if}
  </section>

  <section class="card flush" aria-labelledby="o-keys">
    <div class="card-head">
      <h2 id="o-keys">Invoice keys</h2>
      <span class="hint inline">Each service you run points its checkout at its own key. The wallet and the server are shared.</span>
      <button class="small" onclick={onKeys}>Manage keys</button>
    </div>
    <div class="scroll">
      <table class="data">
        <thead><tr><th>Key</th><th>Address</th><th>Relays</th><th class="num">Open</th><th class="num">Received · 30 d</th><th>Share</th><th></th></tr></thead>
        <tbody>
          {#each keyRows(health, keyLists) as k (k.id)}
            <tr>
              <td><KeyChip label={k.label} color={k.color} />{#if k.id === 'invoices'} <span class="hint inline">original</span>{/if}</td>
              <td class="mono" title={npubOf(k.pubkey)}>{shortNpub(k.pubkey)}</td>
              <td><span class={`dot inline ${relayTone(k.relays)}`} aria-hidden="true"></span> {`${k.relays.connected} of ${k.relays.urls.length}`}</td>
              <td class="num">{k.open}</td>
              <td class="num">{k.received}</td>
              <td><meter min="0" max="100" value={k.share} aria-label={`${k.label}: ${k.share}% of the last 30 days`}></meter></td>
              <td class="num">
                {#if k.pubkey !== ''}<button class="sm" onclick={() => copyNpub(k.id, k.pubkey)}>{copied === k.id ? 'Copied' : 'Copy npub'}</button>{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>

  {#if several && keyLists}
    <div class="segmented takings" role="group" aria-label="Show takings of">
      <button class={takings === '' ? 'primary' : ''} aria-pressed={takings === ''} onclick={() => (takings = '')}>All keys</button>
      {#each keyLists.all.keys as k (k.id)}
        <button class={takings === k.id ? 'primary' : ''} aria-pressed={takings === k.id} onclick={() => (takings = k.id)}><KeyChip label={k.label} color={k.color} archived={k.archived_at !== null} /></button>
      {/each}
    </div>
  {/if}
  {@const picked = takings === '' || keyLists === null ? null : keyLists.all.keys.find((k) => k.id === takings)}
  <section class="totals" aria-label="Totals">
    {#if picked}
      <div>
        <span class="lbl">Received</span>
        <strong>{formatBtc(picked.totals.confirmed_sat)}</strong>
        <span class="note-line">{`${formatSats(picked.totals.confirmed_sat)} · ${picked.label}`}</span>
      </div>
      <div>
        <span class="lbl">Payments</span>
        <strong>{picked.totals.confirmed}</strong>
        <span class="note-line">{`${totalsOf(keyLists!.recent.keys, picked.id).confirmed} in the last 30 days`}</span>
      </div>
      <div>
        <span class="lbl">Invoices</span>
        <strong>{invoiceCount(picked.totals)}</strong>
        <span class="note-line">{`${openCount(picked.totals)} open`}</span>
      </div>
    {:else}
      <div>
        <span class="lbl">Received</span>
        <strong>{formatBtc(metrics.received_sat)}</strong>
        <span class="note-line">{formatSats(metrics.received_sat)}</span>
      </div>
      <div>
        <span class="lbl">Payments</span>
        <strong>{metrics.payments}</strong>
        <span class="note-line">{`${metrics.windows[0].count} in the last 24 hours`}</span>
      </div>
      <div>
        <span class="lbl">Invoices</span>
        <strong>{metrics.invoices}</strong>
        <span class="note-line">{`${health.database.invoices} in the database`}</span>
      </div>
    {/if}
    <div>
      <span class="lbl">Addresses created</span>
      <strong>{metrics.addresses_created}</strong>
      <span class="note-line">never reused</span>
    </div>
  </section>

  <section class="card" aria-labelledby="o-payments">
    <div class="card-head">
      <h2 id="o-payments">Payments</h2>
      <div class="segmented" role="group" aria-label="Chart range">
        {#each RANGES as r (r.value)}
          <button class={range === r.value ? 'primary' : ''} aria-pressed={range === r.value} onclick={() => (range = r.value)}>{r.label}</button>
        {/each}
      </div>
      <label class="inline-select" for="metric">Show</label>
      <select id="metric" bind:value={metric}>
        <option value="sat">Amount</option>
        <option value="count">Number of payments</option>
      </select>
    </div>
    <Chart {series} {metric} />
    <details class="periods">
      <summary>Totals by period</summary>
      <p class="hint">{`Online since ${formatTime(metrics.online_since)} (${formatDuration(metrics.now - metrics.online_since)}).`}</p>
      <div class="scroll">
        <table>
          <thead><tr><th>Period</th><th>Payments</th><th>Amount</th></tr></thead>
          <tbody>
            {#each metrics.windows as w (w.label)}
              <tr>
                <td>{WINDOW_LABELS[w.label]}</td>
                {#if w.available}
                  <td>{w.count}</td><td>{formatSats(w.sat)}</td>
                {:else}
                  <!-- Not online for the whole period yet: the figure covers only the time it has been. -->
                  <td class="muted">{`${w.count} so far`}</td>
                  <td class="muted">{`${formatSats(w.sat)}; complete after ${formatDuration(w.secs)} online`}</td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  </section>

  {#if recent.length > 0}
    <section class="card flush" aria-labelledby="o-drops">
      <div class="card-head">
        <h2 id="o-drops">Recent drops</h2>
        <button class="link" onclick={onDrops}>All invoices</button>
      </div>
      <div class="scroll">
        <table class="data">
          <thead><tr><th>Drop</th>{#if several}<th>Key</th>{/if}<th>Status</th><th class="num">Amount</th><th>Address</th><th>Created</th></tr></thead>
          <tbody>
            {#each recent as inv (inv.id)}
              <tr>
                <td class="mono">{dropId(inv.index)}</td>
                {#if several}
                  {@const k = dropKey(inv.key)}
                  <td>{#if k}<KeyChip label={k.label} color={k.color} archived={k.archived} />{:else}<span class="muted">—</span>{/if}</td>
                {/if}
                <td><span class={`badge ${inv.status}`}>{statusLabel(inv.status)}</span></td>
                <td class="num">{formatSats(inv.amount_sat)}</td>
                <td class="mono muted address-cell">{inv.address}</td>
                <td class="muted">{formatTime(inv.created_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}

  <section class="card" aria-labelledby="o-sweep">
    <div class="card-head">
      <h2 id="o-sweep">PayJoin / CoinJoin sweep</h2>
      <span class={metrics.sweep.enabled ? 'badge confirmed' : 'badge expired'}>{metrics.sweep.enabled ? 'on' : 'off'}</span>
    </div>
    {#if metrics.sweep.enabled}
      <p>
        {`${metrics.sweep.mode === 'payjoin' ? 'PayJoin' : 'CoinJoin'} above ${formatBtc(metrics.sweep.threshold_sat)}. Received so far: ${formatBtc(metrics.sweep.received_sat)}.`}
      </p>
      <p class={metrics.sweep.due ? 'warning' : 'muted'}>{metrics.sweep.due ? 'The threshold is reached: a sweep is due.' : 'Below the threshold.'}</p>
    {/if}
    <p class="hint">This service holds no spending keys. The policy is for a separate signer to carry out; nothing is sent from here.</p>
  </section>

  <div class="key-strips">
    <ServiceKey label="Administration" purpose="Only operators sign in through this key. Do not publish it." pubkey={keyOf(health, 'admin', adminPubkey)} profile={false} />
  </div>
{/if}
