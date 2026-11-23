import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

// Workspace packages resolve to their TypeScript sources. The views run in the
// browser only (the dashboard is a single-page app), so there is no SSR run.
export default defineConfig({
  plugins: [svelte(), svelteTesting()],
  resolve: { conditions: ['deadhop-source', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['deadhop-source', ...defaultServerConditions] } },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,svelte}'],
      exclude: ['src/**/*.test.ts', 'src/test-helpers.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
});
