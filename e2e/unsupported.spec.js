const { test, expect } = require('@playwright/test');

test.describe('Unsupported browser — no WebCodecs', () => {
  test.beforeEach(async ({ page }) => {
    // Remove WebCodecs APIs before the page script runs
    await page.addInitScript(() => {
      window.VideoEncoder     = undefined;
      window.VideoDecoder     = undefined;
      window.VideoFrame       = undefined;
      window.EncodedVideoChunk = undefined;
    });
    // Suppress the intentional thrown error so Playwright doesn't flag it
    page.on('pageerror', () => {});
    await page.goto('/');
  });

  test('shows the support warning', async ({ page }) => {
    await expect(page.locator('#support-warn')).toBeVisible();
  });

  test('hides the video preview', async ({ page }) => {
    await expect(page.locator('#preview')).toBeHidden();
  });

  test('hides the pattern track', async ({ page }) => {
    await expect(page.locator('#pattern-track')).toBeHidden();
  });

  test('hides the progress bar', async ({ page }) => {
    await expect(page.locator('#progress-wrap')).toBeHidden();
  });

  test('hides the controls', async ({ page }) => {
    await expect(page.locator('#controls')).toBeHidden();
  });
});
