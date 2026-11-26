# Install the npm workspace and the Svelte 4 test project
install:
    npm ci
    npm ci --prefix packages/svelte/test-svelte4

# Unit tests with enforced 100% coverage: every package, the console and the dashboard
test:
    for w in packages/client packages/react packages/solid packages/svelte packages/network-ui console dashboard; do npm test --workspace "$w" || exit 1; done
    npm run test:svelte4 --workspace packages/svelte

# Type checks (tsc, svelte-check)
check:
    for w in packages/client packages/react packages/solid packages/svelte packages/network-ui console dashboard; do npm run check --workspace "$w" || exit 1; done

# Prove the npm packages are distributable: pack, install into fresh React, Solid,
# Svelte 5 and Svelte 4 projects, build, type-check, publint, attw and a JSR dry run.
# Publishes nothing.
packages:
    scripts/check-packages.sh

# End-to-end payments on regtest (the console's tests load the built client, so build it
# first). Needs the deadhop workspace around this
# repository (or DEADHOP_WORKSPACE pointing at it) with `just up` and `just server` running there.
e2e:
    npm run build --workspace @deadhop/client
    npm run e2e --workspace console
    npm run e2e --workspace dashboard
    npm run e2e --workspace packages/client
    npm run e2e --workspace packages/e2e

# Build the dashboard and serve the production build at http://127.0.0.1:4173
dashboard:
    cd dashboard && npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
