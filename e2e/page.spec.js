const { test, expect } = require('@playwright/test');

const PATTERN      = '00110011001100110011';
const TOTAL_FRAMES = PATTERN.length; // 20

test.describe('Page structure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('has correct title', async ({ page }) => {
    await expect(page).toHaveTitle('WebCodecs Frame Capture');
  });

  test('start button is visible and enabled', async ({ page }) => {
    const btn = page.locator('#startBtn');
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('renders correct number of pattern bits', async ({ page }) => {
    await expect(page.locator('.pbit')).toHaveCount(TOTAL_FRAMES);
  });

  test('pattern bits have correct B / W labels', async ({ page }) => {
    const bits = page.locator('.pbit');
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      await expect(bits.nth(i)).toHaveText(PATTERN[i] === '1' ? 'W' : 'B');
    }
  });

  test('white bits have the bit-w CSS class', async ({ page }) => {
    const expectedCount = PATTERN.split('').filter((b) => b === '1').length;
    await expect(page.locator('.pbit.bit-w')).toHaveCount(expectedCount);
  });

  test('output section is hidden on load', async ({ page }) => {
    await expect(page.locator('#output-section')).toBeHidden();
  });

  test('support warning is hidden when WebCodecs is available', async ({ page }) => {
    await expect(page.locator('#support-warn')).toBeHidden();
  });

  test('status text contains initial prompt', async ({ page }) => {
    await expect(page.locator('#status-text')).toContainText('Start');
  });

  test('video preview element is attached to DOM', async ({ page }) => {
    await expect(page.locator('#preview')).toBeAttached();
  });
});
