import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import { Activity, LIMITS } from '../lib/activity.svelte';
import Loading from './Loading.svelte';

describe('Loading', () => {
  afterEach(() => vi.useRealTimers());

  it('says what is loading and where the wait is, and turns slow', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let t = 0;
    const watch = new Activity(() => t);
    render(Loading, { props: { label: 'Loading invoices', watch } });
    expect(screen.getByRole('status').textContent).toBe('Loading invoices');
    // Nothing is waiting yet: no step line.
    expect(document.querySelector('.loading-step')).toBeNull();

    void watch.track('list_invoices', () => new Promise(() => undefined));
    flushSync();
    expect(document.querySelector('.loading-step')!.textContent).toBe('Waiting for the service · 0 s');
    t = LIMITS.slowMs;
    vi.advanceTimersByTime(1000);
    flushSync();
    expect(document.querySelector('.loading')!.className).toBe('loading slow');
    expect(document.querySelector('.loading-step')!.textContent).toBe('The service is slow to answer · 5 s');
  });

  it('uses the shared activity by default', () => {
    render(Loading, { props: { label: 'Loading settings' } });
    expect(screen.getByRole('status').textContent).toBe('Loading settings');
  });
});
