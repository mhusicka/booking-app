const { test, expect } = require('@playwright/test');
const {
  unlockSite,
  dateFromToday,
  clickCalendarDay,
  waitForAvailability,
  toIsoDate,
} = require('./helpers');

test.describe('Rezervační stránka', () => {
  test.beforeEach(async ({ page }) => {
    await unlockSite(page);
    await waitForAvailability(page);
  });

  test('načte kalendář a status dostupnosti', async ({ page }) => {
    await expect(page.locator('#calendar-wrapper .day').first()).toBeVisible();
    await expect(page.locator('#today-status')).not.toContainText('Načítám');
    await expect(page.locator('#today-status')).not.toContainText('Chyba');
  });

  test('minulé dny v kalendáři mají class past a nejsou klikatelné', async ({ page }) => {
    const yesterday = dateFromToday(-1);
    const yesterdayEl = page.locator(`.day[data-date="${yesterday}"]`);

    // Yesterday may be in previous month view — skip if not in DOM
    if ((await yesterdayEl.count()) === 0) {
      test.skip(true, 'Včerejšek není v aktuálním měsíci kalendáře');
    }

    await expect(yesterdayEl).toHaveClass(/past/);
    await yesterdayEl.click({ force: true });
    await expect(page.locator('#date-start-text')).toHaveText('-');
  });

  test('výběr budoucího dne nastaví termín a spočítá cenu (min. 1 den)', async ({ page }) => {
    const start = dateFromToday(2);
    await clickCalendarDay(page, start);

    // Auto-selection nastaví konec (+24h) nebo ukáže modal gaps
    const gapsModal = page.locator('#gaps-modal-overlay');
    if (await gapsModal.isVisible()) {
      await page.locator('#gaps-modal-cancel').click();
      await clickCalendarDay(page, start);
      await clickCalendarDay(page, dateFromToday(3));
    }

    await expect(page.locator('#inp-date-start')).not.toHaveValue('');
    await expect(page.locator('#total-price')).not.toHaveText('0 Kč');
    await expect(page.locator('#day-count')).not.toHaveText('0');
  });

  test('tlačítko TEĎ nastaví dnešní start a ne minulý čas 06:00 pokud je později', async ({ page }) => {
    page.once('dialog', async (dialog) => {
      await dialog.accept();
    });

    await page.click('#btn-now');
    await expect(page.locator('#inp-date-start')).not.toHaveValue('', { timeout: 15_000 });

    const startDate = await page.locator('#inp-date-start').inputValue();
    expect(startDate >= toIsoDate(new Date())).toBeTruthy();

    const startTime = await page.locator('#inp-time').inputValue();
    const now = new Date();
    // Pokud je po 6:00 a start je dnes, začátek nesmí zůstat 06:00
    if (now.getHours() >= 7 && startDate === toIsoDate(now)) {
      expect(startTime).not.toBe('06:00');
    }
  });

  test('ručně nastavený čas v minulosti dnes zablokuje odeslání', async ({ page }) => {
    const today = toIsoDate(new Date());
    await clickCalendarDay(page, today);

    const gapsModal = page.locator('#gaps-modal-overlay');
    if (await gapsModal.isVisible()) {
      // vezmi první volný úsek, pak přepíšeme čas
      await page.locator('.btn-gap-option').first().click();
    }

    await page.fill('#inp-time', '00:01');
    await page.locator('#inp-time').dispatchEvent('change');

    // Pokud je teď po půlnoci, 00:01 je v minulosti → chyba
    const now = new Date();
    if (now.getHours() > 0 || now.getMinutes() > 1) {
      await expect(page.locator('#btn-submit')).toBeDisabled();
      await expect(page.locator('#date-end-text')).toContainText(/MINULOSTI|minulosti/i);
    }
  });

  test('bez souhlasu a kontaktů nejde odeslat', async ({ page }) => {
    const start = dateFromToday(5);
    await clickCalendarDay(page, start);

    const gapsModal = page.locator('#gaps-modal-overlay');
    if (await gapsModal.isVisible()) {
      await page.locator('.btn-gap-option').first().click();
    }

    await page.fill('#inp-name', '');
    await page.locator('#btn-submit').click({ force: true });
    // Submit handler preventDefault + validace — zůstáváme na stránce
    await expect(page).toHaveURL(/\/$/);
  });
});
