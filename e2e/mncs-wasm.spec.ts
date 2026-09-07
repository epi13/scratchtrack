/**
 * Real-browser E2E over the PRODUCTION build (dist/ served under
 * /scratchtrack/): proves the browser fetches, instantiates, and
 * executes compiled MNCS WASM through actual ScratchTrack call sites —
 * with path attribution, so identical output alone never decides which
 * path ran. Prerequisite: `npm run build` (the webServer serves dist/;
 * server.mjs refuses stale output).
 */
import { expect, test, type Page } from '@playwright/test';

const APP = './?mncs-test=1';

interface Hook {
  ready: () => Promise<boolean>;
  states: () => Promise<Record<string, string>>;
  errors: () => Promise<Record<string, string | null>>;
  stats: () => Promise<Record<string, { wasm: number; fallback: number }>>;
  resetStats: () => Promise<void>;
  ops: Record<string, (...args: never[]) => Promise<unknown>>;
}

// The hook object holds JS functions, which do not survive a structured
// clone across the page/node boundary, so every method call goes through
// page.evaluate and only serializable arguments/results cross.
async function hook(page: Page): Promise<Hook> {
  await page.waitForFunction(() => (window as unknown as { __mncs?: unknown }).__mncs !== undefined);
  const call = <T>(expr: string, args: unknown[] = []): Promise<T> =>
    page.evaluate(([e, a]) => {
      const h = (window as unknown as { __mncs: Record<string, never> }).__mncs;
      const fn = e.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], h);
      return (fn as (...x: unknown[]) => T)(...a);
    }, [expr, args] as const);
  const ops = (name: string) => (...args: never[]) => call(`ops.${name}`, args);
  return {
    ready: () => call('ready'),
    states: () => call('states'),
    errors: () => call('errors'),
    stats: () => call('stats'),
    resetStats: () => call('resetStats'),
    ops: {
      barTicks: ops('barTicks'),
      parsePosition: ops('parsePosition'),
      crc32: ops('crc32'),
      wrapTick: ops('wrapTick'),
      clipActive: ops('clipActive'),
      remapIndex: ops('remapIndex'),
      magicCode: ops('magicCode'),
      centralEntryNameLen: ops('centralEntryNameLen'),
    },
  };
}

async function wasmRequests(page: Page): Promise<string[]> {
  const urls: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.wasm')) urls.push(new URL(request.url()).pathname);
  });
  return urls;
}

test('browser fetches, instantiates, and executes all eight MNCS modules', async ({ page }) => {
  const urls = await wasmRequests(page);
  await page.goto(APP);
  const h = await hook(page);
  expect(await h.ready()).toBe(true);
  const states = await h.states();
  for (const name of ['meter', 'arrange', 'migrate', 'geometry', 'wav', 'pack', 'text', 'crc']) {
    expect(states[name]).toBe('ready');
  }
  // Correct base path for every artifact request.
  expect(urls.length).toBeGreaterThanOrEqual(8);
  for (const url of urls) expect(url.startsWith('/scratchtrack/mncs/')).toBe(true);

  // Real call sites through the hook, WASM-attributed.
  await h.resetStats();
  expect(await h.ops.barTicks(4, 4)).toBe(96);
  expect(await h.ops.parsePosition('7.3.2')).toBe(636 / 24);
  expect(await h.ops.crc32([49, 50, 51, 52, 53, 54, 55, 56, 57])).toBe(0xcbf43926);
  expect(await h.ops.wrapTick(-1, 96)).toBe(95);
  expect(await h.ops.remapIndex(8, 16, 12)).toBe(6);
  expect(await h.ops.magicCode([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])).toBe(1);
  const stats = await h.stats();
  for (const fn of ['bar_ticks', 'parse_position', 'crc_update', 'wrap_tick', 'remap_index', 'magic_code']) {
    expect(stats[fn]?.wasm ?? 0).toBeGreaterThan(0);
  }
});

test('loop-point edit flows through WASM parsing into UI state', async ({ page }) => {
  await page.goto(APP);
  const h = await hook(page);
  expect(await h.ready()).toBe(true);
  await h.resetStats();
  // Move the Out point first: the app clamps In below Out, and the demo
  // fixture's loop ends before bar 7.
  const outInput = page.getByLabel('Out point as bar.beat');
  await outInput.fill('9.1');
  await outInput.press('Enter');
  const input = page.getByLabel('In point as bar.beat');
  await input.fill('7.3.2');
  await input.press('Enter');
  // UI state updated: the input reformats the committed position, and the
  // sixteenth survives the round trip through MNCS position_ticks.
  await expect(input).toHaveValue('7.3.2');
  const stats = await h.stats();
  expect(stats['parse_position']?.wasm ?? 0).toBeGreaterThan(0);
});

test('fallback answers correctly when WASM cannot load', async ({ page }) => {
  await page.route('**/*.wasm', (route) => route.abort());
  await page.goto(APP);
  const h = await hook(page);
  const states = await h.states();
  for (const name of ['meter', 'arrange', 'migrate', 'geometry', 'wav', 'pack', 'text', 'crc']) {
    expect(states[name]).toBe('failed');
  }
  await h.resetStats();
  expect(await h.ops.barTicks(4, 4)).toBe(96);
  expect(await h.ops.parsePosition('7.3.2')).toBe(636 / 24);
  expect(await h.ops.crc32([49, 50, 51, 52, 53, 54, 55, 56, 57])).toBe(0xcbf43926);
  const stats = await h.stats();
  expect(stats['bar_ticks']?.fallback ?? 0).toBeGreaterThan(0);
  expect(stats['parse_position']?.fallback ?? 0).toBeGreaterThan(0);
});

test('reload re-instantiates cleanly and stays WASM-backed', async ({ page }) => {
  await page.goto(APP);
  let h = await hook(page);
  expect(await h.ready()).toBe(true);
  await page.reload();
  h = await hook(page);
  expect(await h.ready()).toBe(true);
  await h.resetStats();
  expect(await h.ops.barTicks(7, 8)).toBe(84);
  const stats = await h.stats();
  expect(stats['bar_ticks']?.wasm ?? 0).toBeGreaterThan(0);
});

test('service worker registers without breaking WASM execution', async ({ page }) => {
  await page.goto(APP);
  const h = await hook(page);
  expect(await h.ready()).toBe(true);
  const registered = await page.evaluate(async () =>
    'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistration()) !== undefined : 'unsupported',
  );
  expect(registered).toBe(true);
  // Second load under the active worker is still WASM-backed.
  await page.reload();
  const h2 = await hook(page);
  expect(await h2.ready()).toBe(true);
  await h2.resetStats();
  expect(await h2.ops.barTicks(4, 4)).toBe(96);
  expect(((await h2.stats())['bar_ticks']?.wasm ?? 0)).toBeGreaterThan(0);
});

test('tampered artifact fails digest verification and falls back', async ({ page }) => {
  await page.route('**/crc.wasm', async (route) => {
    const response = await route.fetch();
    const bytes = Buffer.from(await response.body());
    bytes[bytes.length - 1] ^= 0xff;
    await route.fulfill({ response, body: bytes });
  });
  await page.goto(APP);
  const h = await hook(page);
  // The tampered fetch resolves asynchronously; wait for settle instead
  // of asserting a mid-load snapshot.
  await page.waitForFunction(
    () => (window as unknown as { __mncs?: { states?: () => Record<string, string> } }).__mncs?.states?.()['crc'] !== 'loading',
  );
  const states = await h.states();
  expect(states['crc']).toBe('failed');
  expect((await h.errors())['crc'] ?? '').toMatch(/digest/);
  // Other modules are unaffected (failure isolation).
  expect(states['meter']).toBe('ready');
  await h.resetStats();
  expect(await h.ops.crc32([49, 50, 51, 52, 53, 54, 55, 56, 57])).toBe(0xcbf43926);
  expect(((await h.stats())['crc32_table']?.fallback ?? 0)).toBeGreaterThan(0);
});
