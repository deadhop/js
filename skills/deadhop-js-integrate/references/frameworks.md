# Per-framework details

Checked against the package sources in deadhop/js (`packages/react`, `packages/solid`,
`packages/svelte/src/svelte5`, `packages/svelte/src/svelte4`, `packages/client`). For anything
not shown here, fetch the framework's guide.

| | React | Solid | Svelte 5 | Svelte 4 |
| --- | --- | --- | --- | --- |
| Import from | `@deadhop/react` | `@deadhop/solid` | `@deadhop/svelte` | `@deadhop/svelte/svelte4` |
| Extra class | `className` | `class` | `class` | `class` |
| `PayButton` text | `children` | `children` | `label` | `label` |
| Events | callback props | callback props | callback props | callback props (not `on:` events) |
| Custom markup | `useCheckout(client, opts)` → `[state, checkout]` | `useCheckout(client, opts)` → `[state accessor, checkout]` | `useCheckout(client, { pollMs, events: () => ({…}) })` → `{ state, checkout }` | `createCheckout(client, opts)`, a Svelte store: `$checkout` |
| Guide | https://deadhop.run/docs/integrate-react.md | https://deadhop.run/docs/integrate-solid.md | https://deadhop.run/docs/integrate-svelte5.md | https://deadhop.run/docs/integrate-svelte4.md |

Each package also exports `InvoiceCard` (the invoice view the components use) for custom
markup, and `LABELS` comes from `@deadhop/client`.

## React

```tsx
import { PayButton } from '@deadhop/react';
import '@deadhop/react/styles.css';
import { deadhop } from './deadhop';

export function Tip() {
  return (
    <PayButton client={deadhop} amount={5000} memo="Thanks!" onPaid={(inv) => console.log('paid', inv.id)}>
      Tip 5,000 sats
    </PayButton>
  );
}
```

The components are marked `'use client'`, so they work in the Next.js App Router.

## Solid

```tsx
import { PayButton } from '@deadhop/solid';
import '@deadhop/solid/styles.css';
import { deadhop } from './deadhop';

export function Tip() {
  return (
    <PayButton client={deadhop} amount={5000} memo="Thanks!" onPaid={(inv) => console.log('paid', inv.id)}>
      Tip 5,000 sats
    </PayButton>
  );
}
```

## Svelte 5

```svelte
<script lang="ts">
  import { PayButton } from '@deadhop/svelte';
  import '@deadhop/svelte/styles.css';
  import { deadhop } from '$lib/deadhop';
</script>

<PayButton client={deadhop} amount={5000} memo="Thanks!" label="Tip 5,000 sats" onPaid={(inv) => console.log('paid', inv.id)} />
```

## Svelte 4 (or Svelte 5 in legacy mode)

```svelte
<script>
  import { PayButton } from '@deadhop/svelte/svelte4';
  import '@deadhop/svelte/styles.css';
  import { deadhop } from './lib/deadhop.js';
</script>

<PayButton client={deadhop} amount={5000} label="Buy the ebook" onPaid={(inv) => console.log('paid', inv.id)} />
```

There is no `useCheckout` here. For custom markup, `createCheckout` (re-exported from
`@deadhop/svelte/svelte4`) returns a store; call `checkout.destroy()` in `onDestroy` to stop
polling.

## An invoice the back end created (all frameworks)

```tsx
<Invoice client={deadhop} id={invoiceId} onPaid={refresh} />
```

`refresh` stands for whatever reloads the order state from your back end. In plain
JavaScript, `createCheckout(deadhop).watch(invoiceId)` does the same.

## No framework

`createCheckout(client, { pollMs, onCreated, onDetected, onPaid, onError })` from
`@deadhop/client` returns a checkout with `getState`, `subscribe`, `create(input)`,
`watch(id)`, `reset()` and `destroy()`. `invoiceView(invoice, now)` gives the address,
`bip21` URI, QR path and countdown ready to render. Write service data with `textContent`,
never `innerHTML`. Full example: https://deadhop.run/docs/integrate-javascript.md.

## Checkout phases

`state.phase` is one of `idle`, `creating` (includes the proof of work), `loading`,
`pending`, `detected`, `confirmed`, `expired`, `error`. Only `confirmed`, checked again on
the server, means paid.
