// @ts-check
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

// Vlastní port, ať se netrefíme do jiné aplikace na :3000
const PORT = process.env.PLAYWRIGHT_PORT || 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node server.js',
    url: `${BASE_URL}/api/settings`,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      ...process.env,
      PORT: String(PORT),
    },
  },
});
