import { test, expect } from "@playwright/test";

test.describe("Dashboard Smoke Tests", () => {
  test("should load dashboard page successfully", async ({ page }) => {
    // Navigate to dashboard
    await page.goto("http://localhost:3000/dashboard");

    // Check page title
    await expect(page).toHaveTitle(/Equilibrium/i);

    // Check main heading
    const heading = page.locator("h1");
    await expect(heading).toContainText("Overview");
  });

  test("should display system status", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");

    // Check for system status section
    const systemStatus = page.locator("text=System Status");
    await expect(systemStatus).toBeVisible();

    // Check for status indicators
    await expect(page.locator("text=operational")).toBeVisible();
    await expect(page.locator("text=mock")).toBeVisible();
  });

  test("should display KPI cards", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");

    // Check for all KPI cards
    const kpiLabels = [
      "Recommended Opportunities",
      "Expected Value",
      "Active Payment Intents",
      "Open Reconciliation",
    ];

    for (const label of kpiLabels) {
      const element = page.locator(`text=${label}`);
      await expect(element).toBeVisible();
    }
  });

  test("should have working sidebar navigation", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");

    // Check sidebar navigation items
    const navItems = [
      "Overview",
      "Liquidity Opportunities",
      "Payment Operations",
      "Dispute Evidence",
      "Reconciliation",
      "Demo Controls",
      "Scope & Controls",
    ];

    for (const item of navItems) {
      const navLink = page.locator(`a:has-text("${item}")`);
      await expect(navLink).toBeVisible();
    }
  });

  test("should navigate to opportunities from sidebar", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");

    // Click opportunities link
    await page.click('a:has-text("Liquidity Opportunities")');

    // Wait for navigation
    await page.waitForURL("**/dashboard/opportunities");

    // Verify page content
    const heading = page.locator("h1");
    await expect(heading).toContainText("Liquidity Opportunities");
  });

  test("should display demo mode banner", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");

    // Check for demo mode banner
    const demoBanner = page.locator("text=Demo Mode");
    await expect(demoBanner).toBeVisible();

    // Check banner contains key info
    await expect(demoBanner).toContainText("MockRazorpay");
    await expect(demoBanner).toContainText("Synthetic Data");
  });

  test("should handle API errors gracefully", async ({ page }) => {
    // Simulate API error by going to invalid route
    await page.goto("http://localhost:3000/dashboard/invalid-route");

    // Should show error or redirect
    const url = page.url();
    const errorIndicator = page.locator("text=not found, 404");

    // Either we got redirected or we see an error
    const hasError = await errorIndicator.isVisible().catch(() => false);
    expect(hasError || !url.includes("invalid-route")).toBe(true);
  });

  test("should display operator info in sidebar", async ({ page }) => {
    await page.goto("http://localhost:3000/dashboard");

    // Check for operator ID
    const operatorInfo = page.locator("text=demo-finance-operator");
    await expect(operatorInfo).toBeVisible();
  });

  test("should load from root and redirect to dashboard", async ({ page }) => {
    // Navigate to root
    await page.goto("http://localhost:3000/");

    // Should redirect to dashboard
    await page.waitForURL("**/dashboard");

    const url = page.url();
    expect(url).toContain("/dashboard");

    // Verify we see dashboard content
    const heading = page.locator("h1");
    await expect(heading).toContainText("Overview");
  });
});
