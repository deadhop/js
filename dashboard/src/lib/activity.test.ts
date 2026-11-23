import { describe as group, expect, it } from 'vitest';
import { Activity, LIMITS, describe, elapsedText, toolLabel } from './activity.svelte';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, tick: (ms: number) => (t += ms) };
}

group('Activity', () => {
  it('follows each connection’s steps separately', () => {
    const c = clock();
    const a = new Activity(c.now);
    const one = a.listener();
    const two = a.listener();
    one({ type: 'start', step: 'sign', id: 1 });
    two({ type: 'start', step: 'publish', id: 1 });
    one({ type: 'receive' });
    expect(a.steps.map((s) => s.step)).toEqual(['sign', 'publish']);
    one({ type: 'end', step: 'sign', id: 1, ok: true });
    expect(a.steps.map((s) => s.key)).toEqual(['2:1']);
  });

  it('records a call while it waits, then the answer or the failure', async () => {
    const c = clock();
    const a = new Activity(c.now);
    let answer: (v: number) => void = () => undefined;
    const call = a.track('get_health', () => new Promise<number>((r) => (answer = r)));
    expect(a.calls).toEqual([{ id: 1, tool: 'get_health', since: 1_000_000 }]);
    c.tick(300);
    answer(7);
    expect(await call).toBe(7);
    expect(a.calls).toEqual([]);
    expect(a.lastAnswer).toBe(1_000_300);

    await expect(a.track('list_invoices', () => Promise.reject(new Error('The service did not answer.')))).rejects.toThrow();
    expect(a.failure).toEqual({ what: 'Loading invoices', message: 'The service did not answer.', at: 1_000_300 });
    // The next answer clears it.
    await a.track('get_info', async () => 1);
    expect(a.failure).toBeNull();
  });

  it('runs a bigger piece of work under one label', async () => {
    const a = new Activity(clock().now);
    let seen: unknown = null;
    expect(await a.run('Signing in', async () => ((seen = a.task), 'ok'))).toBe('ok');
    expect(seen).toEqual({ label: 'Signing in', since: 1_000_000 });
    expect(a.task).toBeNull();
    await expect(a.run('Signing in', () => Promise.reject('no extension'))).rejects.toBe('no extension');
    expect(a.failure).toMatchObject({ what: 'Signing in', message: 'no extension' });
    a.reset();
    expect([a.steps, a.calls, a.task, a.lastAnswer, a.failure]).toEqual([[], [], null, null, null]);
  });

  it('uses the real clock by default', () => {
    const before = Date.now();
    expect(new Activity().now()).toBeGreaterThanOrEqual(before);
  });
});

group('describe', () => {
  const none = { steps: [], calls: [], task: null, lastAnswer: null, failure: null };
  const call = (tool: string, since = 0) => ({ id: 1, tool, since });

  it('is ready before anything happened and up to date after an answer', () => {
    expect(describe(none, 0)).toEqual({ tone: 'idle', what: 'Ready', text: '', since: null, waiting: 0 });
    expect(describe({ ...none, lastAnswer: 5 }, 9)).toMatchObject({ tone: 'idle', what: 'Up to date' });
  });

  it('shows the last failure until the next answer', () => {
    const failure = { what: 'Loading invoices', message: 'The service did not answer.', at: 1 };
    expect(describe({ ...none, failure }, 2)).toEqual({
      tone: 'problem',
      what: 'Loading invoices failed',
      text: 'The service did not answer.',
      since: null,
      waiting: 0,
    });
  });

  it('names the oldest call and counts the rest', () => {
    expect(describe({ ...none, calls: [call('get_health')] }, 100)).toEqual({
      tone: 'busy',
      what: 'Loading service health',
      text: 'Waiting for the service',
      since: 0,
      waiting: 1,
    });
    expect(describe({ ...none, calls: [call('get_health'), { ...call('get_metrics'), id: 2 }] }, 100).what).toBe('Loading service health and 1 more');
  });

  it('keeps a short refresh in the background quiet', () => {
    const a = { ...none, lastAnswer: 0, calls: [call('get_health', 100)] };
    expect(describe(a, 100 + LIMITS.quietMs - 1)).toMatchObject({ tone: 'idle', what: 'Up to date', waiting: 1 });
    expect(describe(a, 100 + LIMITS.quietMs)).toMatchObject({ tone: 'busy', what: 'Loading service health' });
    // Not while something is wrong, nor while signing in.
    expect(describe({ ...a, failure: { what: 'x', message: 'y', at: 0 } }, 101)).toMatchObject({ tone: 'busy' });
    expect(describe({ ...a, task: { label: 'Signing in', since: 100 } }, 101)).toMatchObject({ tone: 'busy' });
  });

  it('turns slow, then into a problem, while the service does not answer', () => {
    const a = { ...none, calls: [call('get_health')] };
    expect(describe(a, LIMITS.slowMs)).toMatchObject({ tone: 'slow', text: 'The service is slow to answer' });
    expect(describe(a, LIMITS.stuckMs)).toMatchObject({ tone: 'problem', text: expect.stringContaining('No answer from the service yet') });
  });

  it('says when the request is still with the relays', () => {
    const a = { ...none, calls: [call('get_health')], steps: [{ key: '1:1', step: 'publish' as const, since: 0 }] };
    expect(describe(a, 10)).toMatchObject({ tone: 'busy', text: 'Sending to the relays' });
    expect(describe(a, LIMITS.slowMs)).toMatchObject({ tone: 'slow', text: 'The relays are slow to accept the request' });
    expect(describe(a, LIMITS.stuckMs)).toMatchObject({ tone: 'problem', text: 'No relay has accepted the request yet. Still trying.' });
  });

  it('ignores a step left over from before the calls now waiting', () => {
    const a = { ...none, calls: [call('get_health', 50)], steps: [{ key: '1:1', step: 'decrypt' as const, since: 10 }] };
    expect(describe(a, 60)).toMatchObject({ tone: 'busy', text: 'Waiting for the service' });
  });

  it('says when it waits for the signer, and hints at an approval when that is slow', () => {
    for (const [step, words] of [
      ['key', 'share your public key'],
      ['sign', 'sign the request'],
      ['encrypt', 'encrypt the request'],
      ['decrypt', 'decrypt the reply'],
    ] as const) {
      const a = { ...none, task: { label: 'Signing in', since: 0 }, steps: [{ key: '1:1', step, since: 0 }] };
      expect(describe(a, 10)).toEqual({ tone: 'busy', what: 'Signing in', text: `Waiting for your signer to ${words}`, since: 0, waiting: 0 });
      expect(describe(a, LIMITS.slowMs)).toMatchObject({ tone: 'slow', text: expect.stringContaining('asking you to approve') });
    }
  });
});

group('toolLabel and elapsedText', () => {
  it('says what a call does', () => {
    expect(toolLabel('list_invoices')).toBe('Loading invoices');
    expect(toolLabel('some_new_tool')).toBe('some new tool');
  });

  it('counts seconds, then minutes', () => {
    expect(elapsedText(-5)).toBe('0 s');
    expect(elapsedText(12_400)).toBe('12 s');
    expect(elapsedText(75_000)).toBe('1 min 15 s');
  });
});
