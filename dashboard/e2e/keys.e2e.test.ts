// The two keys in a real browser against a private service: sign in through the
// administration key, give a relay and a proxy to one key only, and what the
// dashboard says when a key would be left with nothing. Requires `just up`
// (relay and Electrum) and a service binary (DEADHOP_BIN, or a build under
// server/target). Set PROOF_DIR to also write screenshots there.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dashboardDir, serverBinary, startPoolStack, type PoolStack } from './pool-stack';

const chrome = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const binary = serverBinary();
const proofs = process.env.PROOF_DIR;

// The same relay under two addresses: the service sees two relays.
const RELAY_A = 'ws://127.0.0.1:7777';
const RELAY_B = 'ws://localhost:7777';

const hasText = (page: Page, text: string, timeout = 90_000) =>
  page.waitForFunction((t) => document.body.innerText.toLowerCase().includes(t), { timeout }, text.toLowerCase());

async function click(page: Page, selector: string) {
  const handle = await page.waitForSelector(selector);
  await handle!.click();
}
const button = (page: Page, name: string) => click(page, `::-p-xpath(//button[normalize-space()="${name}"])`);
/** Open one of the Network tab's views (Routes, Relays, Proxies, Rules). */
const view = (page: Page, name: string) => click(page, `::-p-xpath(//button[@role="tab"][starts-with(normalize-space(.), "${name}")])`);
/** A "used by" switch: the label that holds the checkbox for `what` and `key`. */
const byLabel = (page: Page, label: string) => click(page, `[aria-label="${label}"]`);
const chip = (page: Page, what: string, key: string) => click(page, `label:has(input[aria-label="${what} used by ${key}"])`);
/** Open `tab` afresh (the views read the service when they open) until `text` shows. */
async function reopenUntil(page: Page, tab: string, text: string, ms = 150_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    await button(page, tab === 'Overview' ? 'Network' : 'Overview');
    await button(page, tab);
    // The view appears once the page has read the settings; a slow read is retried.
    if (tab === 'Network') await view(page, 'Proxies').catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
    if ((await page.evaluate(() => document.body.innerText)).toLowerCase().includes(text.toLowerCase())) return;
    if (Date.now() > deadline) throw new Error(`"${text}" did not show on ${tab}`);
  }
}

describe.skipIf(!existsSync(chrome) || binary === null)('two keys in a real browser', () => {
  let stack: PoolStack;
  let browser: Browser;
  let page: Page;
  const problems: string[] = [];

  async function shot(name: string, target?: ElementHandle | null) {
    if (!proofs) return;
    mkdirSync(proofs, { recursive: true });
    await new Promise((r) => setTimeout(r, 300));
    const path = join(proofs, `${name}.png`) as `${string}.png`;
    if (target) await target.screenshot({ path });
    else await page.screenshot({ path, clip: { x: 0, y: 0, width: 1280, height: 1000 } });
  }
  const card = () => page.$('section.card[aria-labelledby="s-conn"]');
  const proxies = () => page.$('section.proxy-pool');

  beforeAll(async () => {
    stack = await startPoolStack(binary!, { DEADHOP_RELAYS: `${RELAY_A},${RELAY_B}` });
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, defaultViewport: { width: 1280, height: 2000, deviceScaleFactor: 2 } });
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

  it('refuses a key that is not an operator, and signs an operator in through the administration key', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deadhop-keys-'));
    execFileSync('node', ['scripts/keygen.mjs', join(dir, 'stranger')], { cwd: dashboardDir, stdio: 'ignore' });
    await page.goto(stack.url);
    await page.waitForSelector('#secret');
    await shot('01-sign-in');
    await page.type('#secret', readFileSync(join(dir, 'stranger.nsec'), 'utf8').trim());
    await button(page, 'Sign in');
    await hasText(page, 'This key is not an operator of this service.');
    await shot('02-not-an-operator');

    await page.goto(stack.url);
    await page.type('#secret', stack.nsec);
    await button(page, 'Sign in');
    await hasText(page, 'Addresses created');
    await hasText(page, 'Public invoices');
    await hasText(page, 'Administration');
    await shot('03-overview-two-keys', await page.$('.key-strips'));
  }, 180_000);

  it('gives a relay to one key only, and shows it', async () => {
    await button(page, 'Network');
    await view(page, 'Relays');
    await hasText(page, 'Keys');
    await shot('04-settings-keys-and-relays', await card());
    // The second relay is for the public key only.
    await chip(page, RELAY_B, 'Administration');
    await shot('05-relay-for-one-key', await card());
    await button(page, 'Save changes');
    await hasText(page, 'No unsaved changes.');
    for (let i = 0; i < 40 && !(await page.$('.key-badges')); i++) {
      await button(page, 'Network');
      await button(page, 'Overview');
      await new Promise((r) => setTimeout(r, 1500));
    }
    await page.waitForSelector('.key-badges', { timeout: 5_000 });
    await shot('06-overview-relay-badges');
    const keys = await page.$eval('.key-strips', (e) => (e as HTMLElement).innerText);
    expect(keys).toContain('Do not publish it');
    expect(keys).not.toContain(RELAY_B);
  }, 240_000);

  it('will not let a key lose its last relay, nor the page its own way in', async () => {
    await button(page, 'Network');
    await view(page, 'Relays');
    await hasText(page, 'Keys');
    const locked = (relay: string, key: string) => page.$eval(`input[aria-label="${relay} used by ${key}"]`, (el) => (el as HTMLInputElement).disabled);
    // The second relay is for the public key only, so the first is the
    // administration key's last relay (and the one this page signs in over).
    expect(await locked(RELAY_A, 'Administration')).toBe(true);
    await shot('07-last-relay-locked', await card());
    // Giving the administration key the second relay too: the first stays
    // locked, because this page signs in through it.
    await chip(page, RELAY_B, 'Administration');
    expect(await locked(RELAY_A, 'Administration')).toBe(true);
    expect(await locked(RELAY_B, 'Administration')).toBe(false);
    await shot('08-page-relay-locked', await card());
    await button(page, 'Discard');
    await hasText(page, 'No unsaved changes.');
  }, 240_000);

  it('gives the administration key a default route of its own, and stops a save that blocks a key', async () => {
    await button(page, 'Network');
    await view(page, 'Rules');
    await byLabel(page, 'Edit the default route');
    // Every key goes through the first proxy (the environment's, strategy off);
    // the administration key goes through the second instead.
    const [, second] = stack.proxies.map((p) => p.url);
    await click(page, '::-p-xpath((//label[contains(normalize-space(.), "A different default route for this key")])[2])');
    await click(page, `::-p-xpath(//div[@aria-label="Everything else goes, for Administration"]//label[contains(normalize-space(.), "Through ${second}")])`);
    await button(page, 'Done');
    await shot('09-default-route-per-key');
    await button(page, 'Save changes');
    await hasText(page, 'No unsaved changes.');
    await reopenUntil(page, 'Network', `Administration: ${second}, reachable`);
    await shot('10-proxy-in-use-per-key', await proxies());

    // Blocking everything else for the public key leaves it with no relay.
    await view(page, 'Rules');
    await byLabel(page, 'Edit the default route');
    await click(page, '::-p-xpath(//div[@aria-label="Everything else goes"]//label[contains(normalize-space(.), "Nowhere: block")])');
    await button(page, 'Save changes');
    await hasText(page, 'The rules and the default route block every relay of Public invoices');
    await shot('11-blocked-no-relay');
    await button(page, 'Discard');
    await hasText(page, 'No unsaved changes.');
  }, 300_000);

  it('raised no errors in the page', () => {
    expect(problems).toEqual([]);
  });
});
