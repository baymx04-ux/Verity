import { test, expect } from '@playwright/test';

const ADMIN = { email: 'admin@verity.dev', password: 'verity-admin-dev' };
const ANALYST = { email: 'analyst@verity.dev', password: 'verity-analyst-dev' };
const VIEWER = { email: 'viewer@verity.dev', password: 'verity-viewer-dev' };

async function login(page: any, credentials: { email: string; password: string }) {
  await page.locator('input[name="email"]').fill(credentials.email);
  await page.locator('input[type="password"]').fill(credentials.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL('/chat', { timeout: 15_000, until: 'domcontentloaded' });
}

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/login');
  await page.waitForLoadState('networkidle');
});

test.describe('login', () => {
  test('admin can log in and reach chat', async ({ page }) => {
    await login(page, ADMIN);
    await expect(page.getByRole('heading', { name: /Verity/i })).toBeVisible();
  });

  test('analyst can log in and reach chat', async ({ page }) => {
    await login(page, ANALYST);
    await expect(page.getByRole('heading', { name: /Verity/i })).toBeVisible();
  });

  test('viewer can log in and reach chat', async ({ page }) => {
    await login(page, VIEWER);
    await expect(page.getByRole('heading', { name: /Verity/i })).toBeVisible();
  });

  test('rejected with wrong password', async ({ page }) => {
    await page.locator('input[name="email"]').fill(ADMIN.email);
    await page.locator('input[type="password"]').fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 10_000 });
  });
});

test.describe('chat (authenticated)', () => {
  test('asks a question and receives a cited answer', async ({ page }) => {
    await login(page, ADMIN);
    await page.locator('textarea#composer-input').fill('What is the annual leave entitlement for full-time employees?');
    await page.getByRole('button', { name: /ask/i }).click();

    await expect(page.getByText(/annual leave/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/citation/i).or(page.getByTestId('citation-1'))).toBeVisible();
  });

  test('submits feedback on a message', async ({ page }) => {
    await login(page, ADMIN);
    await page.locator('textarea#composer-input').fill('How many active products are in the Furniture category?');
    await page.getByRole('button', { name: /ask/i }).click();
    await expect(page.getByText(/furniture/i)).toBeVisible({ timeout: 30_000 });

    const thumbsUp = page.getByRole('button', { name: /helpful/i }).last();
    await expect(thumbsUp).toBeVisible();
    await thumbsUp.click();
    await expect(page.getByText(/feedback recorded/i)).toBeVisible();
  });
});

test.describe('sql panel (authenticated)', () => {
  test('analyst can ask a SQL question and see results', async ({ page }) => {
    await login(page, ANALYST);
    await page.locator('textarea#composer-input').fill('Which sales region had the highest net revenue over the last 12 months?');
    await page.getByRole('button', { name: /ask/i }).click();

    await expect(page.getByText(/revenue|region|emea|americas|apac/i).last()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('tab', { name: /sql/i })).toBeVisible();
  });
});

test.describe('admin guard', () => {
  test('viewer cannot access the admin page', async ({ page }) => {
    await login(page, VIEWER);
    await page.goto('/admin');
    await expect(page.getByText(/access restricted|different role/i).first()).toBeVisible();
  });
});
