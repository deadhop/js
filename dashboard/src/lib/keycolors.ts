// The keys' colours tell keys apart in tables and charts, on this dashboard
// only. The palette is the network views' (`--kc0` to `--kc7`, graphite for
// the administration key); a key stores its index. This file only names them.
import { KEY_PALETTE } from '@deadhop/network-ui/lib/keys';

/** What each colour of the network views' palette is called, by index. */
export const COLOR_NAMES: readonly string[] = ['Teal', 'Blue', 'Rust', 'Purple', 'Berry', 'Ochre', 'Sky', 'Moss'];

/** The class that sets `--kc` to a key's colour; `null` is the administration key's graphite. */
export const colorClass = (index: number | null) => (index === null ? 'kc-admin' : `kc${index % KEY_PALETTE}`);
