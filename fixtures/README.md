Copies of files from https://github.com/deadhop/server. Change them there first, then copy them here.

- `route-patterns.json` (server `fixtures/`): the routing contract. The Rust router and
  `@deadhop/network-ui` both run these cases.
- `server-snapshots/` (server `tests/snapshots/`): what the service sends, as its snapshot
  tests record it. `@deadhop/network-ui` parses them with its schemas.

From the deadhop workspace, `just fixtures-check` compares these copies with the server's.
