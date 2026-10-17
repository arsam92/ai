import { test, expect } from '@playwright/test';

const capturedByPage = new WeakMap();

test.beforeEach(async ({ page }) => {
  const captured = [];
  capturedByPage.set(page, captured);

  page.on('console', (message) => {
    if (message.type() === 'error') {
      captured.push({ type: 'console.error', text: message.text(), location: message.location() });
    }
  });
  page.on('pageerror', (error) => {
    captured.push({ type: 'pageerror', name: error.name, message: error.message, stack: error.stack });
  });
  page.on('requestfailed', (request) => {
    captured.push({
      type: 'requestfailed',
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText ?? 'unknown'
    });
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      captured.push({ type: 'http-error', url: response.url(), status: response.status() });
    }
  });
});

test.afterEach(async ({ page }, testInfo) => {
  const captured = capturedByPage.get(page) ?? [];
  await testInfo.attach('browser-console-network-audit.json', {
    body: Buffer.from(JSON.stringify({
      test: testInfo.title,
      status: testInfo.status,
      browser: 'Chromium via Playwright',
      baseURL: testInfo.project.use.baseURL,
      unexpectedErrorCount: captured.length,
      events: captured
    }, null, 2)),
    contentType: 'application/json'
  });
  expect(captured, 'Unexpected browser Console/page/network errors; inspect the attached JSON report').toEqual([]);
});

test('loads the real WebGL viewport and character', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('renderer-ready')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('render-canvas')).toBeVisible();
  const canvasSize = await page.getByTestId('render-canvas').evaluate((canvas) => {
    const rect = canvas.getBoundingClientRect();
    return { width: rect.width, height: rect.height, backingWidth: canvas.width, backingHeight: canvas.height };
  });
  expect(canvasSize.width).toBeGreaterThan(0);
  expect(canvasSize.height).toBeGreaterThan(0);
  expect(canvasSize.backingWidth).toBeGreaterThan(0);
  expect(canvasSize.backingHeight).toBeGreaterThan(0);
  await expect(page.getByTestId('renderer-error')).toBeHidden();
});

test('edits a joint, adds a keyframe, and exports valid animation JSON', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('renderer-ready')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /Left shoulder/ }).click();
  await page.getByTestId('joint-angle').fill('28');
  await expect(page.locator('[data-value-for="shoulderL"]')).toHaveText('28°');
  await page.getByTestId('timeline-frame').fill('12');
  await page.getByTestId('add-keyframe').click();
  await expect(page.getByTestId('key-count')).toHaveText('1 keyframe');
  await expect(page.getByTestId('editor-status')).toContainText('Added keyframe at frame 12');

  const downloadWait = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadWait;
  expect(download.suggestedFilename()).toBe('riglab-animation.json');
  const exported = await page.evaluate(() => window.__RIGLAB_LAST_EXPORT__);
  expect(exported.schemaVersion).toBe(1);
  expect(exported.keyframes).toHaveLength(1);
  expect(exported.keyframes[0].frame).toBe(12);
  expect(exported.keyframes[0].pose.shoulderL).toBe(28);
});

test('creates a walk-cycle preset and supports play/pause and scrubbing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('renderer-ready')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Create walk cycle' }).click();
  await expect(page.getByTestId('key-count')).toHaveText('5 keyframes');
  await page.getByRole('button', { name: 'Play animation' }).click();
  await expect(page.getByRole('button', { name: 'Pause animation' })).toBeVisible();
  await expect(page.getByTestId('play-state')).toHaveText('Playing');
  await page.waitForTimeout(180);
  await page.getByRole('button', { name: 'Pause animation' }).click();
  await expect(page.getByTestId('play-state')).toHaveText('Paused');
  await page.getByTestId('timeline-frame').fill('30');
  await expect(page.getByTestId('frame-readout')).toHaveText('Frame 30 / 60');
});

test('rejects invalid animation JSON without crashing', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('renderer-ready')).toBeVisible({ timeout: 20_000 });
  await page.locator('#import-file').setInputFiles({
    name: 'invalid-clip.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ schemaVersion: 99, keyframes: [] }))
  });
  await expect(page.getByTestId('editor-status')).toContainText('Invalid animation file');
  await expect(page.getByTestId('renderer-ready')).toBeVisible();
});

test('stays usable on a narrow screen with reduced motion enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByTestId('renderer-ready')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Create walk cycle' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
  await page.getByRole('button', { name: 'Create walk cycle' }).click();
  await expect(page.getByTestId('key-count')).toHaveText('5 keyframes');
});
