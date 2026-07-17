const { test, expect } = require('@playwright/test');
const { ADMIN_PASSWORD } = require('./helpers');

test.describe('Admin panel', () => {
  test.skip(!ADMIN_PASSWORD, 'Chybí ADMIN_PASSWORD v .env');

  test('přihlášení do adminu zobrazí přehled rezervací', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#login-section')).toBeVisible();

    await page.fill('#admin-pass', ADMIN_PASSWORD);
    await page.locator('#login-form button[type="submit"]').click();

    await expect(page.locator('#admin-content')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#login-section')).toBeHidden();
  });

  test('neplatné heslo admina nevpustí dovnitř', async ({ page }) => {
    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toMatch(/heslo/i);
      await dialog.accept();
    });

    await page.goto('/admin');
    await expect(page.locator('#login-section')).toBeVisible();
    await page.fill('#admin-pass', 'spatne-heslo');
    await page.locator('#login-form button[type="submit"]').click();

    await expect(page.locator('#admin-content')).toBeHidden();
    await expect(page.locator('#login-section')).toBeVisible();
  });
});
