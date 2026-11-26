---
name: deadhop-js-integrate
description: "Add deadhop bitcoin payments to a web app or a back end with the @deadhop/* packages: pick the package for the framework (React, Solid, Svelte 5, Svelte 4, plain JavaScript, Node/Deno/Bun), create the client with createDeadhop, render PayButton, InvoiceForm or Invoice (or build custom markup with useCheckout / createCheckout), choose between public invoicing with browser proof of work and invoices created by a back end with an operator key, and check invoices with getInvoice before fulfilling orders. Use it whenever someone asks to accept bitcoin, add a pay button, tip jar, checkout or invoice to a site with deadhop, wire @deadhop/client, @deadhop/react, @deadhop/solid or @deadhop/svelte into an app, or verify a deadhop payment on a server."
license: MIT
metadata:
  repository: https://github.com/deadhop/js
---

# Add deadhop payments to an app

A deadhop service has no web address. The page talks to it over Nostr relays, using only the
service's public key and a relay it listens on. The packages handle the connection, the proof
of work a public invoice needs, and following the invoice from *awaiting payment* to *paid*.

The canonical guide is https://deadhop.run/docs/integrate.md. Fetch it, and the page for the
user's framework, before writing code you are unsure of.

## 1. Gather two values from the user

| Value | Where it comes from |
| --- | --- |
| `serverPubkey` | The service's public key, hex or `npub1…`. On the service's host: `deadhop pubkey`. It is also `serverPubkey` in the dashboard's `config.json`. |
| `relays` | At least one relay the service listens on (`wss://…`). |

Ask for them; do not invent them. They are public values, safe to put in front-end code.

## 2. Decide with the user who creates invoices

This is the one design decision that changes the code. Ask it explicitly.

1. **The browser creates them (public invoicing).** The service must allow it:
   `DEADHOP_PUBLIC_INVOICING=true`, or *Public invoicing* in the dashboard's settings. The
   browser signs with a throwaway in-memory key (no Nostr account, no extension prompt) and
   mines a proof of work before each invoice (`DEADHOP_POW_BITS`, 20 bits by default; several
   seconds on a phone). Good for tips, donations, fixed-price items, pages without a back end.
   Use `PayButton` or `InvoiceForm`.
2. **The back end creates them (operator key).** The server holds an operator key, makes the
   invoice, and sends only its id to the page, which shows it with `Invoice`. The key's public
   half goes into `DEADHOP_ADMINS` (or *Settings → Operators*). No proof of work; the server
   sets the amount. See https://deadhop.run/docs/integrate-backend.md.

An operator key can also manage the service (settings, relays, wipe). It stays in the
server's secrets and never goes into a browser bundle, a `VITE_`/`NEXT_PUBLIC_`/`PUBLIC_`
variable, or the repository. Use a key made only for this back end. Never ask the user to
paste an `nsec` into the chat: tell them which environment variable to set themselves.

## 3. Pick the package

| The app | Install | Import components from | Guide |
| --- | --- | --- | --- |
| React 18 or 19 (Next.js too) | `@deadhop/client @deadhop/react` | `@deadhop/react` | https://deadhop.run/docs/integrate-react.md |
| Solid 1.8+ (SolidStart too) | `@deadhop/client @deadhop/solid` | `@deadhop/solid` | https://deadhop.run/docs/integrate-solid.md |
| Svelte 5 (SvelteKit too) | `@deadhop/client @deadhop/svelte` | `@deadhop/svelte` | https://deadhop.run/docs/integrate-svelte5.md |
| Svelte 4, or Svelte 5 in legacy mode | `@deadhop/client @deadhop/svelte` | `@deadhop/svelte/svelte4` | https://deadhop.run/docs/integrate-svelte4.md |
| Any other framework, or none | `@deadhop/client` | `@deadhop/client` (`createCheckout`) | https://deadhop.run/docs/integrate-javascript.md |
| A server (Node 20+, Deno, Bun) | `@deadhop/client` | `@deadhop/client` | https://deadhop.run/docs/integrate-backend.md |

`@deadhop/client`, `@deadhop/react` and `@deadhop/solid` are on npm and JSR;
`@deadhop/svelte` is on npm only. Every framework package re-exports `createDeadhop`.

## 4. Create the client once

```ts
import { createDeadhop } from '@deadhop/client';

export const deadhop = createDeadhop({
  serverPubkey: 'npub1…',               // from step 1
  relays: ['wss://relay.example.com'],  // from step 1
});
```

Create it at module level, once per page or process, and pass it to every component as
`client`. It connects on first use and keeps one connection. Other options it takes:
`signer` (back end: `secretKeySigner(nsec)`), `miner` (faster proof of work with
`notemineMiner()` from `@deadhop/client/notemine`), `timeoutMs`, `mining`, `clientName`,
`onActivity`.

## 5. Render a component

Every framework has the same three components, plus `useCheckout` (React, Solid, Svelte 5) for
custom markup:

| Component | Use it for | Own props |
| --- | --- | --- |
| `PayButton` | A fixed amount; creates the invoice on click (public invoicing) | `amount` (sats), `memo`, `expirySecs`, label |
| `InvoiceForm` | Customer types the amount (public invoicing) | `defaultAmount`, `defaultMemo`, `showMemo`, `expirySecs` |
| `Invoice` | An invoice the back end created | `id` |

All take `client`, `pollMs`, `labels`, a class, `copy`, and the callbacks `onCreated`,
`onDetected`, `onPaid`, `onError`. The framework differences (class prop, button label,
`useCheckout` shape, the Svelte 4 store) and a verified snippet for each framework are in
[references/frameworks.md](references/frameworks.md).

The stylesheet is optional: `@deadhop/react/styles.css`, `@deadhop/solid/styles.css` or
`@deadhop/svelte/styles.css`.

## 6. Check on the server before fulfilling

`onPaid` runs in the customer's browser, which the customer controls. Use it to update the
page, never to release goods. Before shipping, the back end asks the service itself (reading
an invoice needs no special key, so this works whoever created it):

```ts
const invoice = await deadhop.getInvoice(order.invoiceId);
const paid = invoice.status === 'confirmed' && invoice.amount_sat === order.amountSat;
```

- Release only on `confirmed`. `detected` means the payment was seen, not that it is final:
  an unconfirmed payment can still disappear. The required depth is
  `DEADHOP_MIN_CONFIRMATIONS` on the service.
- An `expired` invoice can still become `confirmed` (late payments are watched for
  `DEADHOP_LATE_GRACE_SECS`), so do not cancel an order on `expired` alone.
- Compare `amount_sat` with what the order costs, especially when the browser created the
  invoice.
- There are no webhooks: call `getInvoice` when the page reports `onPaid`, or poll open
  orders on a timer.

## 7. Page security

- If the page has a Content-Security-Policy, `connect-src` must allow `wss:` (the relays). With
  `notemineMiner()`, it also needs `worker-src blob:` and `script-src 'wasm-unsafe-eval'`.
- Importing a component opens nothing; it connects when it mounts, so server-side rendering
  works.

## Verify it worked

1. The page renders the button or form; on click it shows *Preparing invoice…*, then a QR code
   and an address. An `onError` with code `unauthorized` usually means public invoicing is off
   (browser model) or the back-end key is not in `DEADHOP_ADMINS` (back-end model); `timeout`
   means the service does not listen on the given relays.
2. To test without real money, run a service on regtest
   (https://deadhop.run/docs/quickstart.md) and pay the invoice from its test wallet.
3. Confirm the server-side check returns false while the invoice is `pending` or `detected`
   and true only once it is `confirmed` with the right amount.

Checklist for the finished integration: https://deadhop.run/docs/integrate.md (section
"Checklist for agents and developers").
