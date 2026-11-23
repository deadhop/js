import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import Login from './Login.svelte';

describe('Login', () => {
  it('asks which service, then signs in with an extension or a secret key', async () => {
    const onSignIn = vi.fn();
    const target = $state({ pubkey: '', relays: '' });
    render(Login, { props: { target, onSignIn } });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('deadhop console');

    await fireEvent.input(screen.getByLabelText('Administration key'), { target: { value: 'npub1x' } });
    await fireEvent.input(screen.getByLabelText('Relays'), { target: { value: 'ws://127.0.0.1:7777' } });
    expect(target).toEqual({ pubkey: 'npub1x', relays: 'ws://127.0.0.1:7777' });

    await fireEvent.click(screen.getByRole('button', { name: 'Use browser extension' }));
    expect(onSignIn).toHaveBeenLastCalledWith('extension');

    const input = screen.getByLabelText('Secret key') as HTMLInputElement;
    const submit = screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement;
    expect(input.type).toBe('password');
    expect(submit.disabled).toBe(true);
    await fireEvent.input(input, { target: { value: 'nsec1abc' } });
    expect(submit.disabled).toBe(false);
    await fireEvent.submit(input.closest('form')!);
    expect(onSignIn).toHaveBeenLastCalledWith('secret', 'nsec1abc');
    // The key is not left sitting in the form.
    expect(input.value).toBe('');
  });

  it('shows progress and errors, and locks the buttons while busy', () => {
    render(Login, { props: { target: { pubkey: '', relays: '' }, onSignIn: vi.fn(), busy: true, error: 'Could not reach the service.' } });
    expect(screen.getByRole('status').textContent).toBe('Signing in');
    expect(screen.getByRole('alert').textContent).toBe('Could not reach the service.');
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
