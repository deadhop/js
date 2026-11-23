<script lang="ts">
  // Always at the bottom of the window: what the dashboard is doing, how long
  // it has been waiting, and what went wrong last. Details lists every call
  // still waiting.
  import { activity as shared, describe, elapsedText, toolLabel, type Activity } from '@deadhop/network-ui/lib/activity.svelte';

  let { watch = shared, tickMs = 1000, raised = false }: { watch?: Activity; tickMs?: number; raised?: boolean } = $props();

  let now = $state(Date.now());
  $effect(() => {
    now = watch.now();
    const timer = setInterval(() => (now = watch.now()), tickMs);
    return () => clearInterval(timer);
  });
  const status = $derived(describe(watch, now));
  let open = $state(false);
</script>

<div class={`statusbar ${status.tone}${raised ? ' raised' : ''}`}>
  {#if open}
    <section class="status-detail" id="status-detail" aria-label="Activity">
      {#if watch.calls.length === 0}
        <p class="muted">Nothing is waiting for an answer.</p>
      {:else}
        <ul>
          {#each watch.calls as c (c.id)}
            <li><span>{toolLabel(c.tool)}</span><span class="mono muted">{elapsedText(now - c.since)}</span></li>
          {/each}
        </ul>
      {/if}
      <p class="muted">{watch.lastAnswer === null ? 'No answer from the service yet.' : `Last answer ${elapsedText(now - watch.lastAnswer)} ago.`}</p>
      {#if watch.failure}<p class="status-failure">{`Last problem: ${watch.failure.what}. ${watch.failure.message}`}</p>{/if}
    </section>
  {/if}
  <div class="status-inner">
    <span class="status-dot" aria-hidden="true"></span>
    <p class="status-text" role="status"><strong>{status.what}</strong>{#if status.text}<span>{` · ${status.text}`}</span>{/if}</p>
    <!-- Ticks every second, so it stays out of the announced status. -->
    {#if status.since !== null}
      <span class="status-time mono" aria-hidden="true">{elapsedText(now - status.since)}</span>
    {:else if watch.lastAnswer !== null}
      <span class="status-time mono" aria-hidden="true">{`${elapsedText(now - watch.lastAnswer)} ago`}</span>
    {/if}
    <button class="link status-toggle" aria-expanded={open} aria-controls="status-detail" onclick={() => (open = !open)}>{open ? 'Hide details' : 'Details'}</button>
  </div>
</div>
