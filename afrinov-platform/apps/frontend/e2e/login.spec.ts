// Browser E2E: full stack login.
//
// Exercises the complete production path the prototype ships (no
// VITE_FRONTEND_ONLY / VITE_DEMO_AUTH_ENABLED set):
//   browser -> Vite dev proxy -> real backend /api/v1/auth/login
//   -> PostgreSQL (seeded admin) -> JWT stored in localStorage -> dashboard
import { test, expect, type Locator } from '@playwright/test';

const ADMIN_EMAIL = 'admin@afrinov.local';
const ADMIN_PASSWORD = 'ChangeMe!2026';

test.describe('real-backend sign-in flow', () => {
  test('authenticated user reaches the dashboard over a live backend', async ({ page }) => {
    await page.goto('/login', { timeout: 60_000 });
    const emailInput: Locator = page.locator('#login-email');
    const passwordInput: Locator = page.locator('#login-password');
    await emailInput.waitFor({ state: 'visible' });
    await emailInput.fill(ADMIN_EMAIL);
    await passwordInput.fill(ADMIN_PASSWORD);

    await page.getByRole('button', { name: /sign in$/i }).click();

    await page.waitForURL('**/', { timeout: 30_000 });
    await expect(page).toHaveURL('http://localhost:5173/');

    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible();
    await expect(page.getByText('System Administrator')).toBeVisible();

    const token = await page.evaluate(() => localStorage.getItem('afrinov.token'));
    expect(token).not.toBeNull();
    expect(token).toMatch(/^eyJ/);

    await expect(page.locator('form[aria-label="Sign in"]')).toHaveCount(0);
  });

  test('invalid credentials are rejected by the live backend', async ({ page }) => {
    await page.goto('/login', { timeout: 60_000 });
    await page.locator('#login-email').fill(ADMIN_EMAIL);
    await page.locator('#login-password').fill('definitely-wrong');

    await page.getByRole('button', { name: /sign in$/i }).click();

    await expect(page.locator('text=Sign-in failed')).toBeVisible();
    await expect(page).toHaveURL('**/login');
  });
});
