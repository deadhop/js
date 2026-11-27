import { describe, expect, it } from 'vitest';
import { KEY_PALETTE } from '@deadhop/network-ui/lib/keys';
import { COLOR_NAMES, colorClass } from './keycolors';

describe('key colours', () => {
  it('names every colour of the palette and gives each its class', () => {
    expect(COLOR_NAMES).toHaveLength(KEY_PALETTE);
    expect(colorClass(1)).toBe('kc1');
    expect(colorClass(9)).toBe('kc1');
    expect(colorClass(null)).toBe('kc-admin');
  });
});
