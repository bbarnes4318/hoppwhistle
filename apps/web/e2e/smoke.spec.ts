import { test, expect } from '@playwright/test';

// Helper to set up fake authentication in localStorage and mock /api/auth/me response
async function setupAuth(
  page: any,
  user: {
    id: string;
    email: string;
    roles: string[];
    buyerId?: string | null;
    publisherId?: string | null;
    tenantId: string;
  }
) {
  await page.addInitScript((userData: any) => {
    window.localStorage.setItem('token', 'mock-token-xyz');
    window.localStorage.setItem('user', JSON.stringify(userData));
  }, user);

  // Mock /api/auth/me
  await page.route('**/api/auth/me', async (route: any) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: user,
      }),
    });
  });
}

test.describe('E2E Portal Smoke & Security Tests', () => {
  // ────────────────────────────────────────────────────────────────────────────
  // Buyer Portal Smoke Tests
  // ────────────────────────────────────────────────────────────────────────────
  test('Buyer Portal: Hides admin tabs, page loads successfully, restricts financials', async ({
    page,
  }) => {
    await setupAuth(page, {
      id: 'usr-buyer',
      email: 'buyer@e2e.com',
      roles: ['BUYER'],
      buyerId: 'buyer-a',
      tenantId: 'tenant-1',
    });

    // Intercept balance and calls
    await page.route('**/api/v1/billing/balance', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ available: '100.00', total: '100.00' }),
      });
    });

    await page.route('**/api/v1/calls*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      });
    });

    await page.route('**/api/v1/reports/buyer-costs*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], total: 0 }),
      });
    });

    await page.route('**/api/v1/billing/invoices*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    // Go to dashboard
    await page.goto('/buyer/dashboard');

    // Assert sidebar has no Admin-only items
    const buyersLink = page.locator('a[href="/buyers"]');
    await expect(buyersLink).toBeHidden();

    const publishersLink = page.locator('a[href="/publishers"]');
    await expect(publishersLink).toBeHidden();

    // Verify nav links for Buyer are visible
    const callsLink = page.locator('a[href="/buyer/calls"]');
    await expect(callsLink).toBeVisible();

    const walletLink = page.locator('a[href="/buyer/wallet"]');
    await expect(walletLink).toBeVisible();

    // Go to buyer calls page
    await page.goto('/buyer/calls');
    const tableHeader = page.locator('table');
    // Ensure no admin financials columns (like payout, profit, carrier cost) are rendered
    await expect(tableHeader).not.toContainText('Payout');
    await expect(tableHeader).not.toContainText('Profit');
    await expect(tableHeader).not.toContainText('Carrier Cost');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Publisher Portal Smoke Tests
  // ────────────────────────────────────────────────────────────────────────────
  test('Publisher Portal: Hides admin tabs, page loads successfully, restricts financials', async ({
    page,
  }) => {
    await setupAuth(page, {
      id: 'usr-pub',
      email: 'pub@e2e.com',
      roles: ['PUBLISHER'],
      publisherId: 'pub-a',
      tenantId: 'tenant-1',
    });

    await page.route('**/api/v1/calls*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], meta: { total: 0 } }),
      });
    });

    await page.route('**/api/v1/reports/publisher-revenue*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [], total: 0 }),
      });
    });

    // Go to publisher dashboard
    await page.goto('/publisher/dashboard');

    // Assert sidebar has no Admin-only items
    const buyersLink = page.locator('a[href="/buyers"]');
    await expect(buyersLink).toBeHidden();

    // Verify nav links for Publisher are visible
    const setupLink = page.locator('a[href="/publisher/api-setup"]');
    await expect(setupLink).toBeVisible();

    const earningsLink = page.locator('a[href="/publisher/earnings"]');
    await expect(earningsLink).toBeVisible();

    // Go to publisher calls page
    await page.goto('/publisher/calls');
    const tableHeader = page.locator('table');
    // Ensure no admin financials columns (like buyer cost, profit, carrier cost) are rendered
    await expect(tableHeader).not.toContainText('Cost');
    await expect(tableHeader).not.toContainText('Profit');
    await expect(tableHeader).not.toContainText('Carrier Cost');
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Admin Portal Smoke Tests
  // ────────────────────────────────────────────────────────────────────────────
  test('Admin Portal: Renders full admin pages and exposes financial metrics', async ({ page }) => {
    await setupAuth(page, {
      id: 'usr-admin',
      email: 'admin@e2e.com',
      roles: ['ADMIN'],
      tenantId: 'tenant-1',
    });

    await page.route('**/api/v1/reporting/metrics*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {} }),
      });
    });

    await page.route('**/api/v1/reports/campaign-profitability*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.route('**/api/v1/reports/reconciliation*', async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          summaries: { calls: { totalRevenue: '0' }, ledger: { buyerRevenue: '0' } },
          mismatches: {},
        }),
      });
    });

    // Go to dashboard
    await page.goto('/dashboard');

    // Verify Admin-only sidebar links are visible
    const buyersLink = page.locator('a[href="/buyers"]');
    await expect(buyersLink).toBeVisible();

    const reportsLink = page.locator('a[href="/reports"]');
    await expect(reportsLink).toBeVisible();

    // Go to reports page
    await page.goto('/reports');
    // Check that admin-only tabs/elements are present
    const profitabilityHeader = page.locator('text=Campaign Profitability');
    await expect(profitabilityHeader).toBeVisible();
  });
});
