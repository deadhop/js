# deadhop JavaScript

The JavaScript side of [deadhop](https://deadhop.run): the packages that put invoices and
pay buttons into your app, and the two web apps an operator uses.

| Path | Package | What it is |
| --- | --- | --- |
| `packages/client` | [`@deadhop/client`](https://www.npmjs.com/package/@deadhop/client) (npm + JSR) | Connection, validation, proof of work, the headless checkout, QR |
| `packages/react` | [`@deadhop/react`](https://www.npmjs.com/package/@deadhop/react) (npm + JSR) | React components |
| `packages/solid` | [`@deadhop/solid`](https://www.npmjs.com/package/@deadhop/solid) (npm + JSR) | Solid components |
| `packages/svelte` | [`@deadhop/svelte`](https://www.npmjs.com/package/@deadhop/svelte) (npm) | Svelte 5 components, and Svelte 4 at `@deadhop/svelte/svelte4` |
| `packages/network-ui` | `@deadhop/network-ui` (not published) | The network views the dashboard and console share |
| `packages/e2e`, `packages/shared` | (not published) | Every framework's PayButton paying on regtest; shared styles, fixtures, build helpers |
| `dashboard/` | (Docker image) | Checkout for customers, management for operators |
| `console/` | (static page) | A service's network settings: relays, proxies, routing |

```tsx
import { createDeadhop } from '@deadhop/client';
import { PayButton } from '@deadhop/react';   // or @deadhop/solid, @deadhop/svelte, @deadhop/svelte/svelte4

const deadhop = createDeadhop({ serverPubkey: 'npub1…', relays: ['wss://relay.example.com'] });
<PayButton client={deadhop} amount={5000} onPaid={(inv) => console.log(inv.id)} />;
```

Fulfil an order only after your backend has checked the invoice with `getInvoice(id)`.
Guides: [Add payments to your app](https://deadhop.run/docs/integrate.html), with one each
for [React](https://deadhop.run/docs/integrate-react.html),
[Solid](https://deadhop.run/docs/integrate-solid.html),
[Svelte 5](https://deadhop.run/docs/integrate-svelte5.html),
[Svelte 4](https://deadhop.run/docs/integrate-svelte4.html),
[no framework](https://deadhop.run/docs/integrate-javascript.html) and
[your backend](https://deadhop.run/docs/integrate-backend.html). Hosting the dashboard:
[Host the dashboard](https://deadhop.run/docs/dashboard.html). The docs' source is in
[deadhop/site](https://github.com/deadhop/site).

## Develop

Requirements: Node 24, Deno 2 (for the JSR dry run), [`just`](https://github.com/casey/just).

```sh
just install    # npm workspace and the Svelte 4 test project
just test       # unit tests, 100% statements, branches, functions and lines enforced
just check      # tsc and svelte-check
just packages   # pack, install into fresh React, Solid, Svelte 5 and Svelte 4 apps, publint, attw, JSR dry run
just dashboard  # build the dashboard and serve it at http://127.0.0.1:4173
just e2e        # end-to-end payments on regtest (see below)
```

**End-to-end tests** pay real regtest invoices through a real relay, Fulcrum and the
service, in Chrome. They need the development stack, which lives in the deadhop
workspace around this repository: run `just up` and `just server` there. Set
`DEADHOP_WORKSPACE` if the workspace is not this repository's parent directory.

**Copies kept in sync by hand:** `brand/` (fonts and favicon, from
[deadhop/brand](https://github.com/deadhop/brand)) and `fixtures/` (the routing contract and
two service snapshots, from [deadhop/server](https://github.com/deadhop/server)). See the
README in each.

## Release

The four published packages move in lockstep:

```sh
scripts/set-version.sh X.Y.Z   # then commit, push, and push the tag vX.Y.Z
```

`.github/workflows/publish.yml` tests, then publishes to npm and JSR in independent jobs
with trusted publishing (no registry tokens in the repository). Versions already on a
registry are skipped, so a failed run can be retried by hand.

## License

[MIT](LICENSE).
