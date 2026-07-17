const DEBUG_PASSWORD = process.env.DEBUG_PASSWORD || 'Test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

/**
 * Odemkne debug zámek webu (testing-lock overlay).
 * @param {import('@playwright/test').Page} page
 */
async function unlockSite(page) {
  await page.addInitScript(() => {
    localStorage.setItem('vozik_debug_access', 'true');
  });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const lock = page.locator('#testing-lock');
  if (await lock.isVisible()) {
    await page.fill('#test-pass', DEBUG_PASSWORD);
    await page.click('#unlock-btn');
    await lock.waitFor({ state: 'hidden', timeout: 10_000 });
  }
}

/**
 * @param {Date} d
 * @returns {string} YYYY-MM-DD
 */
function toIsoDate(d) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Prague' });
}

/**
 * @param {number} daysFromToday
 * @returns {string}
 */
function dateFromToday(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return toIsoDate(d);
}

/**
 * Klikne na den v kalendáři (musí být viditelný v aktuálním měsíci).
 * @param {import('@playwright/test').Page} page
 * @param {string} isoDate YYYY-MM-DD
 */
async function clickCalendarDay(page, isoDate) {
  const day = page.locator(`.day[data-date="${isoDate}"]`);
  await day.waitFor({ state: 'visible', timeout: 10_000 });
  await day.click();
}

/**
 * Počká na načtení dostupnosti (status badge přestane být „Načítám…“).
 * @param {import('@playwright/test').Page} page
 */
async function waitForAvailability(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('today-status');
    return el && !el.innerText.includes('Načítám');
  }, null, { timeout: 15_000 });
}

module.exports = {
  DEBUG_PASSWORD,
  ADMIN_PASSWORD,
  unlockSite,
  toIsoDate,
  dateFromToday,
  clickCalendarDay,
  waitForAvailability,
};
