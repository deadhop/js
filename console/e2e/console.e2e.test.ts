// The console in a real browser against a private service: sign in to its
// administration key, read the routes and relays, name the relay, save, reload
// and find the name kept by the service. Requires `just up` (relay and
// Electrum) and a service binary (DEADHOP_BIN, or a build under server/target).
// Set PROOF_DIR to also write screenshots there.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { nip19 } from 'nostr-tools';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverBinary, startStack, type Stack } from './stack';

const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const binary = serverBinary();
const proofs = process.env.PROOF_DIR;
const RELAY = 'ws://127.0.0.1:7777';

const hasText = (page: Page, text: string, timeout = 90_000) =>
  page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t), { timeout }, text.toLowerCase());

async function click(page: Page, selector: string) {
  const handle = await page.waitForSelector(selector);
  await handle!.click();
}
const button = (page: Page, name: string) => click(page, `::-p-xpath(//button[normalize-space()="${name}"])`);
const view = (page: Page, name: string) => click(page, `::-p-xpath(//button[@role="tab"][starts-with(normalize-space(.), "${name}")])`);

describe.skipIf(!existsSync(chrome) || binary === null)('network console in a real browser', () => {
  let stack: Stack;
  let browser: Browser;
  let page: Page;
  const problems: string[] = [];

  async function shot(name: string) {
    if (!proofs) return;
    mkdirSync(proofs, { recursive: true });
    await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: join(proofs, `${name}.png`) as `${string}.png`, fullPage: true });
  }

  async function signIn() {
    await page.waitForSelector('#secret');
    await page.type('#secret', stack.nsec);
    await button(page, 'Sign in');
    await hasText(page, 'How the service is reached');
  }

  beforeAll(async () => {
    stack = await startStack(binary!);
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, defaultViewport: { width: 1280, height: 1100, deviceScaleFactor: 2 } });
    page = await browser.newPage();
    page.on('pageerror', (e) => problems.push(`pageerror: ${(e as Error).message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') problems.push(`console: ${m.text()}`);
    });
    page.on('dialog', (d) => void d.accept());
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('signs in to the administration key given as an npub', async () => {
    await page.goto(stack.url);
    await hasText(page, 'deadhop console');
    await shot('console-login');
    await page.type('#pubkey', nip19.npubEncode(stack.adminPubkey));
    await page.type('#relays', RELAY);
    await signIn();
  });

  it('shows the routes, read from the service health', async () => {
    // The Routes view waits for get_health: it renders only once that answer validates.
    await page.waitForSelector('[aria-label="Route of every relay"]', { timeout: 90_000 });
    await shot('console-routes');
  });

  it('names the relay and saves', async () => {
    await view(page, 'Relays');
    await hasText(page, RELAY);
    await page.type(`[aria-label="Name of ${RELAY}"]`, 'Local relay');
    await hasText(page, '1 change');
    await button(page, 'Save changes');
    await hasText(page, 'Saved.');
    await shot('console-saved');
  });

  it('keeps the name after a reload', async () => {
    await page.reload();
    // The service and its relays are remembered in this browser; the secret key is not.
    expect(await page.$eval('#pubkey', (e) => (e as HTMLInputElement).value)).toBe(nip19.npubEncode(stack.adminPubkey));
    expect(await page.$eval('#secret', (e) => (e as HTMLInputElement).value)).toBe('');
    await signIn();
    await view(page, 'Relays');
    const input = await page.waitForSelector(`[aria-label="Name of ${RELAY}"]`);
    await page.waitForFunction((e) => (e as HTMLInputElement).value === 'Local relay', { timeout: 30_000 }, input);
    await hasText(page, 'No unsaved changes.');
  });

  it('opens the proxies and the rules, each with its editor', async () => {
    await view(page, 'Proxies');
    await button(page, 'Create proxy');
    await hasText(page, 'Add to list');
    await shot('console-proxies');
    await button(page, 'Cancel');
    await view(page, 'Rules');
    await button(page, 'New rule');
    await shot('console-rules');
  });

  it('will not remove the only relay this page connects through', async () => {
    await view(page, 'Relays');
    await page.type('#relay', 'wss://other.example');
    await button(page, 'Add');
    await click(page, `[aria-label="Remove ${RELAY}"]`);
    await hasText(page, 'would lock you out');
    await shot('console-replace');
    await button(page, 'Close');
    await button(page, 'Discard');
    await hasText(page, 'No unsaved changes.');
  });

  it('logged no page or console errors (the CSP holds on the production build)', () => {
    expect(problems).toEqual([]);
  });
});
