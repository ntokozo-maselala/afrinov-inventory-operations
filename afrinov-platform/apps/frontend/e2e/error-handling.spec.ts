// Browser E2E: how the application behaves when things go wrong.
//
// These run against the same real stack as login.spec.ts (real backend, real
// Postgres, real Vite proxy) and then break one thing at a time with request
// interception, to prove the user sees calm, actionable feedback rather than a
// raw error, a blank page or a silent failure.
//
// Requires the Playwright browsers and the isolated `_test` database that
// playwright.config.ts/global-setup.ts already mandate for the whole suite.
import { test, expect, type Page } from '@playwright/test';

const ADMIN_EMAIL = 'admin@afrinov.local';

function testAdminPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password?.trim()) {
    throw new Error('SEED_ADMIN_PASSWORD is required and must match the isolated test database seed.');
  }
  return password;
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/login', { timeout: 60_000 });
  await page.locator('#login-email').fill(ADMIN_EMAIL);
  await page.locator('#login-password').fill(testAdminPassword());
  await page.getByRole('button', { name: /sign in$/i }).click();
  await page.waitForURL('**/', { timeout: 30_000 });
}

/** Fail every request to an API path with a status and (optional) body. */
async function failApi(page: Page, match: string | RegExp, status: number, body?: unknown): Promise<void> {
  await page.route(match, (route) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body ?? { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }),
    }),
  );
}

/** No test may ever render a stack trace, a filesystem path or a driver error. */
async function expectNoTechnicalLeak(page: Page): Promise<void> {
  const body = (await page.locator('body').innerText()) ?? '';
  expect(body).not.toMatch(/at\s+\w+\s+\(.*:\d+:\d+\)/);
  expect(body).not.toMatch(/node_modules/);
  expect(body).not.toMatch(/\.(ts|js):\d+/);
  expect(body).not.toMatch(/ECONNREFUSED|PrismaClient|P100[0-9]|Unknown word/);
}

test.describe('failure handling over the live stack', () => {
  test('a failed inventory read shows a retryable error, not a blank page', async ({ page }) => {
    await signIn(page);
    await failApi(page, '**/api/v1/reports/current-stock*', 503, {
      error: { code: 'SERVICE_UNAVAILABLE', message: 'Internal detail that must not be shown' },
    });
    await page.goto('/stock');
    await expect(page.getByText("We're having trouble connecting")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByText('Internal detail that must not be shown')).toHaveCount(0);
    await expectNoTechnicalLeak(page);
  });

  test('a network interruption is reported as a connection problem', async ({ page }) => {
    await signIn(page);
    await page.route('**/api/v1/materials*', (route) => route.abort('connectionrefused'));
    await page.goto('/materials');
    await expect(page.getByText('Connection interrupted')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expectNoTechnicalLeak(page);
  });

  test('a rejected inventory mutation keeps the user on the form and explains why', async ({ page }) => {
    await signIn(page);
    await page.goto('/stock/issue');
    // Fill a valid-looking line so the client-side checks pass and the request
    // is actually sent; the server then refuses it on the business rule.
    await page.getByRole('combobox', { name: /issued to/i }).selectOption({ index: 1 });
    const item = page.getByRole('combobox', { name: 'Item 1' });
    await item.click();
    await item.fill('a');
    // Scope to the combobox's own listbox: the Project <select> also exposes
    // hidden options with role="option".
    await page.getByRole('listbox').getByRole('option').first().click();
    await page.getByRole('spinbutton', { name: 'Quantity' }).fill('1');
    await failApi(page, '**/api/v1/inventory-issues', 422, {
      error: { code: 'INSUFFICIENT_BALANCE', message: 'Only 2 of SKU TEST-1 are available at D-1.' },
    });
    await page.getByRole('button', { name: /^issue stock$/i }).click();
    // The form stays usable and the domain wording (the actual constraint) is
    // shown verbatim; nothing technical leaks.
    await expect(page.locator('form')).toBeVisible();
    await expect(page.getByText('Only 2 of SKU TEST-1 are available at D-1.')).toBeVisible();
    await expect(page.getByText('Cannot issue')).toBeVisible();
    await expectNoTechnicalLeak(page);
  });

  test('an expired session returns the user to sign-in with an explanation', async ({ page }) => {
    await signIn(page);
    // The token stops being accepted while the user is working. Only the next
    // page's request is rejected, so the dashboard's own background calls are
    // left alone and the test does not race the session check.
    await failApi(page, '**/api/v1/materials**', 401, {
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
    await page.getByRole('link', { name: /^Materials$/i }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
    await expect(page.getByText('Your session has ended')).toBeVisible();
    await expectNoTechnicalLeak(page);
  });

  test('a backend outage does not sign the user out', async ({ page }) => {
    await signIn(page);
    // The session is already validated; now the backend goes down. A failed
    // refresh must not be mistaken for a rejected token.
    await failApi(page, '**/api/v1/**', 503, { error: { code: 'SERVICE_UNAVAILABLE', message: 'down' } });
    await page.goto('/materials');
    // The shell and the signed-in session survive the outage.
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 15_000 });
    await expect(page).not.toHaveURL(/\/login$/);
    await expectNoTechnicalLeak(page);
  });
});
