import { afterEach, describe, expect, it, vi } from 'vitest';
import { poll } from './poll';

describe('poll', () => {
  afterEach(() => vi.useRealTimers());

  it('runs now and on every tick, skipping ticks while the last run waits', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const work = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const stop = poll(work, 1000);
    expect(work).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3000);
    // Still waiting: no second round on top of it.
    expect(work).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(work).toHaveBeenCalledTimes(2);
    finish();
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(work).toHaveBeenCalledTimes(2);
  });
});
