// Deployment configuration, served next to the app as `config.json`.
import { z } from 'zod';
import { ConfigSchema, type Config } from './schemas';

/**
 * `relays.json`, written next to the app by the service (when they share a
 * host): the wss:// relays each of its keys listens on now. Relays changed
 * from the dashboard are saved in the service, not in config.json, so without
 * this the page would keep only the relays it was deployed with.
 */
const LiveRelaysSchema = z.object({
  invoices: z.array(z.string().regex(/^wss:\/\/[^\s]+$/)).max(32),
  admin: z.array(z.string().regex(/^wss:\/\/[^\s]+$/)).max(32),
});
type LiveRelays = z.infer<typeof LiveRelaysSchema>;

/** The service's live relays, or none when there is no readable relays.json. */
async function loadLiveRelays(fetcher: typeof fetch): Promise<LiveRelays> {
  try {
    const res = await fetcher('relays.json', { cache: 'no-store' });
    if (res.ok) {
      const parsed = LiveRelaysSchema.safeParse(await res.json());
      if (parsed.success) return parsed.data;
    }
  } catch {
    // An older service, a dev server or a network error: config.json alone.
  }
  return { invoices: [], admin: [] };
}

/** The service's live relays first, then the configured ones, each once. */
const merged = (live: string[], configured: string[]): string[] => [...new Set([...live, ...configured])];

/** Where operators reach the service: the administration key, on its relays (the page's own by default). */
export const adminTarget = (c: Config): Config => ({ ...c, serverPubkey: c.adminPubkey, relays: c.adminRelays ?? c.relays });

export async function loadConfig(fetcher: typeof fetch = fetch): Promise<Config> {
  let raw: unknown;
  try {
    const res = await fetcher('config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    raw = await res.json();
  } catch {
    throw new Error('config.json is missing or unreadable. Copy config.example.json and fill it in.');
  }
  const parsed = ConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error('config.json is invalid: it needs "serverPubkey" (hex or npub), "adminPubkey" (what `deadhop pubkey admin` prints) and "relays" (ws:// or wss:// URLs); "adminRelays" is optional.');
  }
  const config = parsed.data;
  const live = await loadLiveRelays(fetcher);
  const withLive: Config = { ...config, relays: merged(live.invoices, config.relays) };
  if (live.admin.length > 0 || config.adminRelays) withLive.adminRelays = merged(live.admin, config.adminRelays ?? config.relays);
  return withLive;
}
