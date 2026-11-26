---
name: deadhop-js-develop
description: "Contribute to deadhop/js, the repository of the @deadhop/client, @deadhop/react, @deadhop/solid and @deadhop/svelte packages, the dashboard and the network console: install, run the gates (just test with 100% coverage, just check, just packages), run the regtest end-to-end tests, keep fixtures/ and brand/ in sync with deadhop/server and deadhop/brand, and cut a release with scripts/set-version.sh and a vX.Y.Z tag. Use it whenever someone asks to fix a bug, add a feature, write tests, bump a version, publish, or open a pull request in deadhop/js, or when CI fails there."
license: MIT
metadata:
  repository: https://github.com/deadhop/js
---

# Contribute to deadhop/js

## Layout

| Path | What | Published |
| --- | --- | --- |
| `packages/client` | `@deadhop/client`: connection, validation, proof of work, the headless checkout, QR codes | npm, JSR |
| `packages/react`, `packages/solid` | `@deadhop/react`, `@deadhop/solid` | npm, JSR |
| `packages/svelte` | `@deadhop/svelte` (Svelte 5, and Svelte 4 at `/svelte4`) | npm only |
| `packages/network-ui` | network views shared by the dashboard and the console | no |
| `packages/shared` | styles, test fixtures, build helpers | no |
| `packages/e2e` | every framework's `PayButton` paying on regtest | no |
| `dashboard/`, `console/` | the two static apps | Docker image / static build |
| `fixtures/`, `brand/` | copies from other repositories (see below) | no |

## Set up

Requirements: Node 24 (what CI uses), Deno 2 (for the JSR dry run) and
[`just`](https://github.com/casey/just).

```sh
just install    # npm ci, plus the Svelte 4 test project in packages/svelte/test-svelte4
```

## The gates

CI runs these three on every pull request; run them before you push:

```sh
just test       # unit tests of every package, the console and the dashboard, then the Svelte 4 runtime tests
just check      # tsc and svelte-check
just packages   # pack, install into fresh React, Solid, Svelte 5 and Svelte 4 apps, build, publint, attw, JSR dry run
```

For a quick loop, run one npm package: `npm test --workspace packages/client` (or
`packages/react`, `console`, `dashboard`, …) and `npm run check --workspace <same>`.

**Coverage is 100% and enforced.** Every unit-test target (client, react, solid, svelte,
network-ui, console, dashboard) fails below 100% of statements, branches, functions and
lines. Add tests with the code; do not lower a threshold or add an exclusion to get a change
through. A component change usually needs the same test in every framework: the Svelte
packages share scenarios in `packages/shared/test/`.

Keep the packages free of side effects at import (no `window`, no connection until mount):
server-side rendering and tree shaking depend on it, and `just packages` checks the latter.

## End-to-end tests

`just e2e` pays real regtest invoices through a real relay, Fulcrum and the service, in
headless Chrome. They need the regtest stack and builds of the service from
[deadhop/stack](https://github.com/deadhop/stack):

```sh
git clone https://github.com/deadhop/stack && cd stack
just clone      # server, js, lnaddr, wallet and relay land next to stack's files
just up         # bitcoind, Fulcrum and a private relay on regtest
just server     # build and run the service (leave it running)
just e2e        # runs `just e2e` in js/
```

The tests look for the stack one directory above this repository. If the checkout is
elsewhere, set `DEADHOP_WORKSPACE` to the directory that holds the stack's files. The
console's lnaddr tests are skipped unless an lnaddr node build exists there
(`lnaddr/target/…`) or `LNADDR_NODE_BIN` points at one.

Flaky test: the "Payment seen, confirming" step in the component tests has failed on slow CI
runners. Rerun once; a second failure is real.

## Copies from other repositories

Two directories are copies. Change the original first, get it merged there, then copy the files
here in a pull request. Never edit only the copy: the two drift and the next sync overwrites
your change.

- `fixtures/` comes from [deadhop/server](https://github.com/deadhop/server):
  `route-patterns.json` (server `fixtures/`, the routing contract that both the Rust router and
  `@deadhop/network-ui` run) and `server-snapshots/` (server `tests/snapshots/`, what the
  service sends, which `@deadhop/network-ui` parses with its schemas). If a change here needs
  the service to answer differently, the server change comes first, then the copied fixtures,
  then the code here.
- `brand/` (fonts and favicon) comes from [deadhop/brand](https://github.com/deadhop/brand).
  The fonts are under the SIL Open Font License; keep the `OFL-*.txt` files with them.

## Release

The four published packages share one version, and the framework packages pin
`@deadhop/client` to it exactly.

```sh
scripts/set-version.sh X.Y.Z    # every manifest (npm and JSR) and the lockfile
# commit, merge to main, then push the tag:
git tag vX.Y.Z && git push origin vX.Y.Z
```

A `v*` tag runs `.github/workflows/publish.yml`: tests, then npm and JSR in separate jobs with
trusted publishing (no tokens in the repository). Versions already on a registry are skipped,
so a failed run can be retried by hand from the Actions tab. Ask before tagging: a published
version cannot be taken back.

## Docs and pull requests

- User-facing docs (integration guides, dashboard hosting) live in
  [deadhop/site](https://github.com/deadhop/site), not here. A change to a package's API or
  behaviour needs a matching pull request there; the guides are
  https://deadhop.run/docs/integrate.md and the pages it links.
- Keep `README.md` files in this repository in step with what they describe.
- Open issues and pull requests in deadhop/js. A pull request is ready when `just test`,
  `just check` and `just packages` pass.
