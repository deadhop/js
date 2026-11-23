# deadhop console

A standalone page for managing the network settings of a deadhop service: its
relays, which keys use them, relay names, proxies, routing rules and I2P name
registries. It uses the same network views as the dashboard
(`@deadhop/network-ui`) and talks to the service only over Nostr, through the
service's administration key.

Enter the administration key (hex, `npub` or `nprofile`, as `deadhop pubkey
admin` prints it) and the relays it listens on (an `nprofile` brings its own),
then sign in with a browser extension (NIP-07) or a secret key, which is kept
in memory only. The key and relays are remembered in the browser; the secret
key never is. Only the service's operators get through.

It reads the settings with `get_network`, saves only what changed with
`update_network`, and reads `get_health`, `get_relay_history`,
`check_relays`, `check_proxy` and `resolve_i2p_name` for the views.

```sh
npm run dev --workspace console     # development server
npm run build --workspace console   # static build in console/dist
npm test --workspace console        # unit tests (100% coverage)
npm run check --workspace console   # svelte-check
npm run e2e --workspace console     # real browser against a private service (needs `just up`)
```

The build is a static site with a strict Content Security Policy; host it
anywhere, or open it from a local preview.
