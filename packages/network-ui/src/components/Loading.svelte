<script lang="ts">
  // A first load: the mark's hop in motion, what is loading, and where the
  // wait is (from the activity the status bar also shows).
  import { activity as shared, describe, elapsedText, type Activity } from '../lib/activity.svelte';

  let { label, watch = shared, tickMs = 1000 }: { label: string; watch?: Activity; tickMs?: number } = $props();

  let now = $state(Date.now());
  $effect(() => {
    now = watch.now();
    const timer = setInterval(() => (now = watch.now()), tickMs);
    return () => clearInterval(timer);
  });
  const status = $derived(describe(watch, now));
</script>

<div class={`loading ${status.tone}`}>
  <svg class="hop" viewBox="0 0 32 32" aria-hidden="true" focusable="false"
    ><circle class="hop-dot" cx="4.6" cy="20" r="3.1" /><path
      class="hop-arc"
      d="M7.4 16.2C10.5 5 20 2.6 24.5 14.8"
    /><path
      class="hop-box"
      d="M18 18.5H22.3V20.2a1 1 0 0 0 1 1H25.7a1 1 0 0 0 1-1V18.5H31V28.5a1.5 1.5 0 0 1-1.5 1.5H19.5A1.5 1.5 0 0 1 18 28.5Z"
    /></svg
  >
  <div class="loading-words">
    <p class="loading-label" role="status">{label}</p>
    <!-- The status bar announces the steps; here they are only shown. -->
    {#if status.since !== null}<p class="loading-step" aria-hidden="true">{`${status.text} · ${elapsedText(now - status.since)}`}</p>{/if}
  </div>
</div>
