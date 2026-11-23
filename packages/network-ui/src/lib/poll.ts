import { untrack } from 'svelte';

/**
 * Run `work` now and again every `everyMs`, but never twice at once: while
 * the last run is still waiting (slow relays), a tick is skipped instead of
 * stacking another round of requests on top. Returns the stop function.
 */
export function poll(work: () => Promise<unknown>, everyMs: number): () => void {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    // `work` handles its own errors; this only notes that it has settled.
    void work().finally(() => (running = false));
  };
  // Called from an effect: the first run must not make that effect depend on
  // what `work` reads (each answer would run it again at once).
  untrack(run);
  const timer = setInterval(run, everyMs);
  return () => clearInterval(timer);
}
