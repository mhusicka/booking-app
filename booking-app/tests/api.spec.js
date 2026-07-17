const { test, expect } = require('@playwright/test');
const { dateFromToday, toIsoDate } = require('./helpers');

test.describe('API validace termínů a ceny', () => {
  test('GET /api/settings vrátí denní cenu', async ({ request }) => {
    const res = await request.get('/api/settings');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.dailyPrice).toBeGreaterThan(0);
    expect(typeof data.webLocked).toBe('boolean');
  });

  test('GET /availability vrátí pole rezervací', async ({ request }) => {
    const res = await request.get('/availability');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data)).toBeTruthy();
  });

  test('POST /create-payment odmítne začátek v minulosti', async ({ request }) => {
    const today = toIsoDate(new Date());
    const res = await request.post('/create-payment', {
      data: {
        startDate: today,
        endDate: dateFromToday(1),
        time: '00:01',
        endTime: '12:00',
        name: 'Playwright Test',
        email: 'playwright@test.cz',
        phone: '+420777000000',
        price: 1, // úmyslně špatná cena — server ji stejně nesmí použít, pokud projde past check
      },
    });

    const now = new Date();
    if (now.getHours() > 0 || now.getMinutes() > 1) {
      expect(res.status()).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/minulosti/i);
    }
  });

  test('POST /create-payment odmítne konec před začátkem', async ({ request }) => {
    const start = dateFromToday(10);
    const res = await request.post('/create-payment', {
      data: {
        startDate: start,
        endDate: start,
        time: '18:00',
        endTime: '10:00',
        name: 'Playwright Test',
        email: 'playwright@test.cz',
        phone: '+420777000000',
        price: 999,
      },
    });

    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/vrácení|začátku/i);
  });

  test('POST /api/verify-password ověří debug heslo', async ({ request }) => {
    const ok = await request.post('/api/verify-password', {
      data: { password: process.env.DEBUG_PASSWORD || 'Test' },
    });
    expect(ok.ok()).toBeTruthy();

    const bad = await request.post('/api/verify-password', {
      data: { password: 'completely-wrong' },
    });
    expect(bad.status()).toBe(401);
  });
});
