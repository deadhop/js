import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe('entry point', () => {
  it('mounts the app into the page', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    await import('./main');
    expect(document.querySelector('#app main')).not.toBeNull();
    expect(document.querySelector('#app h1')!.textContent).toBe('deadhop console');
  });

  it('refuses to run inside a frame', async () => {
    document.body.innerHTML = '<div id="app"></div>';
    vi.stubGlobal('top', {});
    await import('./main');
    expect(document.querySelector('#app')!.textContent).toBe('This page cannot be shown inside another site.');
    expect(document.querySelector('#app main')).toBeNull();
  });
});
