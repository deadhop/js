import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import App from './App.svelte';
import { activity } from '../lib/activity.svelte';

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('../lib/api', async (original) => ({ ...(await original<typeof import('../lib/api')>()), connect: mocks.connect }));

describe('App and the status bar', () => {
  it('connects with the shared activity, so every call shows in the status bar', async () => {
    mocks.connect.mockReturnValue(new Promise(() => undefined));
    const config = { serverPubkey: 'a'.repeat(64), adminPubkey: 'b'.repeat(64), relays: ['ws://127.0.0.1:7777'] };
    render(App, { props: { loadConfig: vi.fn().mockResolvedValue(config), probe: vi.fn().mockResolvedValue(undefined) } as never });
    await fireEvent.click(await screen.findByRole('button', { name: 'Continue as guest' }));
    await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(1));
    expect(mocks.connect.mock.calls[0][4]).toBe(activity);
    // Signing in shows as the task under way.
    expect(activity.task?.label).toBe('Signing in');
  });
});
