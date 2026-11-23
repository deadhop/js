import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { Activity, LIMITS } from '@deadhop/network-ui/lib/activity.svelte';
import StatusBar from './StatusBar.svelte';

function rig() {
  let t = 1_000_000;
  const watch = new Activity(() => t);
  return { watch, tick: (ms: number) => (t += ms) };
}

const bar = () => document.querySelector('.statusbar')!;
const time = () => document.querySelector('.status-time')?.textContent;

describe('StatusBar', () => {
  afterEach(() => vi.useRealTimers());

  it('is ready before anything happened', () => {
    const { watch } = rig();
    render(StatusBar, { props: { watch } });
    expect(screen.getByRole('status').textContent).toBe('Ready');
    expect(bar().className).toBe('statusbar idle');
    expect(time()).toBeUndefined();
  });

  it('follows a call while it waits, counting the seconds, and turns slow', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { watch, tick } = rig();
    render(StatusBar, { props: { watch, raised: true } });
    let answer: (v: number) => void = () => undefined;
    const call = watch.track('get_health', () => new Promise<number>((r) => (answer = r)));
    flushSync();
    expect(screen.getByRole('status').textContent).toBe('Loading service health · Waiting for the service');
    expect(bar().className).toBe('statusbar busy raised');
    tick(LIMITS.slowMs);
    vi.advanceTimersByTime(1000);
    flushSync();
    expect(bar().className).toBe('statusbar slow raised');
    expect(time()).toBe('5 s');

    // Details lists what is waiting.
    await fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByRole('region', { name: 'Activity' }).textContent).toContain('Loading service health5 s');
    expect(screen.getByText('No answer from the service yet.')).toBeTruthy();

    answer(1);
    await call;
    flushSync();
    expect(screen.getByRole('status').textContent).toBe('Up to date');
    expect(time()).toBe('0 s ago');
    expect(screen.getByText('Nothing is waiting for an answer.')).toBeTruthy();
    expect(screen.getByText('Last answer 0 s ago.')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Hide details' }));
    expect(screen.queryByRole('region', { name: 'Activity' })).toBeNull();
  });

  it('shows the last problem until the next answer', async () => {
    const { watch } = rig();
    render(StatusBar, { props: { watch } });
    await watch.track('list_invoices', () => Promise.reject(new Error('The service did not answer.'))).catch(() => undefined);
    flushSync();
    expect(screen.getByRole('status').textContent).toBe('Loading invoices failed · The service did not answer.');
    expect(bar().className).toBe('statusbar problem');
    await fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Last problem: Loading invoices. The service did not answer.')).toBeTruthy();
  });

  it('uses the shared activity by default', () => {
    render(StatusBar);
    expect(screen.getByRole('status').textContent).toBe('Ready');
  });
});
