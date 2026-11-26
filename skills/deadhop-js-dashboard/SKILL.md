---
name: deadhop-js-dashboard
description: "Host the deadhop dashboard (the static web front where customers pay invoices and operators manage the service) and the deadhop network console (relays, proxies and routing rules for a deadhop service or an lnaddr node or gateway): build them from deadhop/js, write the dashboard's config.json (serverPubkey, adminPubkey, relays, adminRelays), serve them over HTTPS with the right headers or run the dashboard Docker image, and sign in as an operator with a Nostr browser extension. Use it whenever someone asks to deploy, host, configure or fix the deadhop dashboard or console, write or debug config.json, share a payment link with a customer, or sign in to manage their deadhop service."
license: MIT
metadata:
  repository: https://github.com/deadhop/js
---

# Host the deadhop dashboard and console

Both are static pages. They talk to the service only through Nostr relays, so they can live
anywhere: on the node, on a small server, or on a static host. Neither needs a port opened on
the service.

- **Dashboard** (`dashboard/`): customers open payment links there; operators sign in to
  manage invoices, settings and the network.
- **Console** (`console/`): a separate page for network settings only (relays, which keys use
  them, proxies, routing rules, I2P name registries), for a deadhop service or an lnaddr node or
  gateway.

Canonical docs: https://deadhop.run/docs/dashboard.md. Fetch it for details this skill leaves
out.

## Before you start: ask the user

1. **Which keys?** The service's public invoices key (`deadhop pubkey`) and its administration
   key (`deadhop pubkey admin`), both run on the service's host. With Docker Compose:
   `docker compose run --rm --no-deps deadhop pubkey` and `… pubkey admin`. Both are public
   keys; never ask for a secret key.
2. **Which relays?** At least one relay the service listens on (`wss://…`), and the
   administration key's relays if they differ.
3. **Where will it be hosted?** A payment link only works for customers if the dashboard is
   reachable over HTTPS at a public address. Do not suggest forwarding a port from the user's
   home router: it puts their home address on every payment link. A static host or a small
   rented server is the safe choice. An operator-only dashboard can stay on loopback.

## Option A: the Docker image

`dashboard/Dockerfile` builds from the repository root and serves on port 8080 (unprivileged
nginx, with the security headers already set):

```sh
docker build -f dashboard/Dockerfile -t deadhop-dashboard .
```

At start it writes `config.json` from the environment, and refuses to start on bad input:

| Variable | Meaning |
| --- | --- |
| `DEADHOP_SERVER_PUBKEY` | The invoices key; otherwise read from `/public/server.pubkey` (shared volume with the service) |
| `DEADHOP_ADMIN_PUBKEY` | The administration key; otherwise `/public/admin.pubkey` |
| `DEADHOP_DASHBOARD_RELAYS` | Comma-separated relays for the page; falls back to `DEADHOP_RELAYS` |
| `DEADHOP_DASHBOARD_ADMIN_RELAYS` | Optional: the administration key's relays, if they differ |

It also serves `/relays.json` from the shared `/public` volume, so the page follows relay
changes made in the dashboard. With Docker Compose, the `dashboard` service already does all
this: see https://deadhop.run/docs/deploy-compose.md. Publish port 8080 on loopback
(`127.0.0.1:8080:8080`) and put a TLS proxy in front of it.

## Option B: any static host

```sh
git clone https://github.com/deadhop/js && cd js
npm ci && npm run build --workspace dashboard      # → dashboard/dist/
```

Put a `config.json` next to `index.html` (template: `dashboard/public/config.example.json`):

```json
{
  "serverPubkey": "npub1…",
  "adminPubkey": "npub1…",
  "relays": ["wss://relay.example.com"],
  "adminRelays": ["wss://relay.example.com"]
}
```

- `serverPubkey` and `adminPubkey` are required: hex or `npub` (the page rejects an
  `nprofile` here).
- `relays`: 1 to 8 `ws://` or `wss://` URLs. `adminRelays` is optional, same format.
- No other keys: the page rejects unknown fields and shows *config.json is invalid*.

Serve `dist/` over HTTPS with these response headers (a `<meta>` policy cannot express
`frame-ancestors`):

```text
Content-Security-Policy: frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

A Caddy example is in https://deadhop.run/docs/dashboard.md. To try a build locally,
`just dashboard` in deadhop/js serves it at http://127.0.0.1:4173 (it needs a `config.json` in
`dashboard/public/`).

## The console

```sh
npm ci && npm run build --workspace console        # → console/dist/
```

It has no `config.json`. The operator types the service's administration key (hex, `npub` or
`nprofile`) and its relays into the page (an `nprofile` brings its own relays). The page
remembers the key and relays in the browser, never a secret key. For an lnaddr node or
gateway, use that program's admin key; see https://deadhop.run/docs/lnaddr/node.md and
https://deadhop.run/docs/lnaddr/admin.md. Host it like the dashboard, or open it from a local
preview: it is an operator tool, so loopback is the natural place for it.

## Sign in as an operator

1. Use a Nostr browser extension (NIP-07) and choose **Use browser extension**. This is the
   recommended way: the secret key never touches the page.
2. The key must be an operator: listed in `DEADHOP_ADMINS` on the service, or added under
   **Operators** in the dashboard. Use a key made only for this service.
3. Both pages also accept a pasted secret key, kept in memory only. That is acceptable in the
   user's own browser, on the real dashboard. It never belongs anywhere else: not in this chat,
   a terminal, a file, a config, an issue or a screenshot. Never ask the user for an `nsec`; if
   they paste one into the chat, tell them to treat that key as exposed and replace it.

## Share a payment link

On **Invoices**, pick the invoice and **Copy payment link**. It opens `…/#/pay/<id>` on the
dashboard without signing in and follows the payment live. Without a public dashboard, use
**Copy address** and send the address and amount, or show the QR code.

## Verify it worked

1. Open the page: no *config.json is missing* or *config.json is invalid* message.
2. The footer shows the service key the page talks to; it must equal `deadhop pubkey`.
3. Sign in with the extension and reach the operator view. A refusal means the key is not an
   operator, or the page cannot reach the administration key on its relays (check
   `adminRelays`).
4. Check the headers: `curl -sI https://pay.example.com/ | grep -i -E 'content-security|nosniff|referrer'`.
