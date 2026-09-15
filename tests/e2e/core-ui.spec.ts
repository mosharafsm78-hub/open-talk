import { test, expect } from '@playwright/test';

async function openTalk(page) {
  await page.goto('/');
  await expect(page.locator('#talkNow')).toBeVisible();
  await page.locator('#talkNow').click();
  await expect(page.locator('#modal')).toBeVisible();
}

test.describe('Open Talk core UI stability', () => {
  test('home navigation remains usable', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Speak with');
    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.locator('#profile')).toHaveClass(/active/);
    await page.getByRole('button', { name: 'Home' }).click();
    await expect(page.locator('#home')).toHaveClass(/active/);

    expect(errors).toEqual([]);
  });

  test('match modal opens cleanly and can be closed and reopened', async ({ page }) => {
    await openTalk(page);

    await expect(page.locator('#matchControls')).toBeVisible();
    await expect(page.locator('#mic')).toContainText('Find a real person');
    await expect(page.locator('#finish')).toContainText('Leave queue');

    await page.locator('#modalClose').click();
    await expect(page.locator('#modal')).toBeHidden();

    await openTalk(page);
    await expect(page.locator('#matchControls')).toBeVisible();
    await expect(page.locator('#queueSteps')).toBeHidden();
    await expect(page.locator('#searchExperience')).toBeHidden();
    await expect(page.locator('#listen')).toHaveCount(1);
  });

  test('preference controls remain visible before matching starts', async ({ page }) => {
    await openTalk(page);

    await expect(page.locator('#matchGender')).toBeVisible();
    await expect(page.locator('#matchCountry')).toBeVisible();
    await expect(page.locator('#matchLevel')).toBeVisible();
    await expect(page.locator('#matchPriority')).toBeVisible();
    await expect(page.locator('#mic')).toBeEnabled();
  });

  test('mobile layout does not overflow horizontally', async ({ page }) => {
    await page.goto('/');
    const dimensions = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 2);
  });
});
