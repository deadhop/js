import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import I2pRegistries from './I2pRegistries.svelte';
import type { ProxySettings } from '../lib/schemas';
import { REGISTRIES, settings } from '../test-helpers';

const proxiesWith = (i2p_registries: string[]): ProxySettings => ({ ...settings().proxies, i2p_registries });

describe('I2pRegistries', () => {
  it('lists the registries, names the router, and removes one', async () => {
    const proxies = proxiesWith([...REGISTRIES]);
    render(I2pRegistries, { props: { proxies, router: 'i2pd' } });
    expect(screen.getByText(/looked up once through i2pd/)).toBeTruthy();
    const list = screen.getByRole('list', { name: 'I2P name registries' });
    expect(list.textContent).toContain(REGISTRIES[0]);
    expect(list.textContent).toContain(REGISTRIES[1]);
    await fireEvent.click(screen.getByRole('button', { name: 'Remove registry notbob.i2p' }));
    expect(proxies.i2p_registries).toEqual([REGISTRIES[1]]);
  });

  it('adds a valid registry and clears the box', async () => {
    const proxies = proxiesWith([REGISTRIES[0]]);
    render(I2pRegistries, { props: { proxies, router: 'i2pd' } });
    const box = screen.getByLabelText('Add registry') as HTMLInputElement;
    await fireEvent.input(box, { target: { value: '  http://reg.i2p/jump?q={name}  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(proxies.i2p_registries).toEqual([REGISTRIES[0], 'http://reg.i2p/jump?q={name}']);
    expect(box.value).toBe('');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refuses a bad or duplicate registry with a message that typing clears', async () => {
    const proxies = proxiesWith([REGISTRIES[0]]);
    render(I2pRegistries, { props: { proxies, router: 'i2pd' } });
    const box = screen.getByLabelText('Add registry') as HTMLInputElement;
    expect(box.getAttribute('aria-invalid')).toBe('false');
    expect(box.getAttribute('aria-describedby')).toBeNull();
    await fireEvent.input(box, { target: { value: 'https://reg.i2p/{name}' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toBe('A registry address starts with http://.');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(box.getAttribute('aria-describedby')).toBe('registry-error');
    expect(proxies.i2p_registries).toEqual([REGISTRIES[0]]);
    await fireEvent.input(box, { target: { value: REGISTRIES[0] } });
    expect(screen.queryByRole('alert')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert').textContent).toBe('That registry is already listed.');
    expect(proxies.i2p_registries).toEqual([REGISTRIES[0]]);
  });

  it('says names cannot be looked up with no registries', () => {
    render(I2pRegistries, { props: { proxies: proxiesWith([]), router: 'i2pd' } });
    expect(screen.getByText('No registries: names cannot be looked up.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Remove registry/ })).toBeNull();
  });

  it('offers no box once four registries are listed', () => {
    const four = [...REGISTRIES, 'http://a.i2p/?q={name}', 'http://b.i2p/?q={name}'];
    render(I2pRegistries, { props: { proxies: proxiesWith(four), router: 'i2pd' } });
    expect(screen.getByText('Four registries is the most.')).toBeTruthy();
    expect(screen.queryByLabelText('Add registry')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Remove registry/ })).toHaveLength(4);
  });
});
