// Browser E2E: signing out ends the sign-in on the server (system audit F7),
// so a token copied before it stops working, not only the screen's copy.
//
// Uses its own account: signing out ends every sign-in of that person begun no
// later than this one, which would end the admin's sign-ins in the other
// specs running alongside.
import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

const API = 'http://127.0.0.1:4000/api/v1';

function testAdminPassword(): string {
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password?.trim()) throw new Error('SEED_ADMIN_PASSWORD is required and must match the isolated test database seed.');
  return password;
}

test('signing out stops a copied token working on the server', async ({ page, request }) => {
  const admin = await request.post(`${API}/auth/login`, { data: { email: 'admin@afrinov.local', password: testAdminPassword() } });
  expect(admin.status()).toBe(200);
  const adminToken = (await admin.json()).token as string;
  const email = `e2e-signout-${randomBytes(4).toString('hex')}@afrinov.local`;
  const password = `E2e-${randomBytes(12).toString('base64url')}-9`;
  const made = await request.post(`${API}/users`, {
    headers: { authorization: `Bearer ${adminToken}` },
    data: { email, name: 'E2E Sign-out', password, roleNames: ['VIEWER'], mustChangePassword: false },
  });
  expect(made.status()).toBe(201);

  await page.goto('/login', { timeout: 60_000 });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  await page.getByRole('button', { name: /sign in$/i }).click();
  await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible({ timeout: 30_000 });
  const copied = await page.evaluate(() => localStorage.getItem('afrinov.token'));
  expect(copied).toMatch(/^eyJ/);
  const me = () => request.get(`${API}/auth/me`, { headers: { authorization: `Bearer ${copied}` } });
  expect((await me()).status()).toBe(200);

  const signedOut = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/v1/auth/logout');
  await page.getByRole('button', { name: /sign out/i }).click();
  expect((await signedOut).status()).toBe(204);
  await expect(page.locator('#login-email')).toBeVisible();

  const after = await me();
  expect(after.status()).toBe(401);
  expect((await after.json()).error.message).toBe('You signed out. Sign in again.');
});
