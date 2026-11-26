Copies of files from https://github.com/deadhop/server. Change them there first, then copy them here.

- `route-patterns.json` (server `fixtures/`): the routing contract. The Rust router and
  `@deadhop/network-ui` both run these cases.
- `server-snapshots/` (server `tests/snapshots/`): what the service sends, as its snapshot
  tests record it. `@deadhop/network-ui` parses them with its schemas.

When you update them, compare each copy with the server's original byte for byte (`cmp`); they
must stay identical.
