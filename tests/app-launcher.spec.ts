import { test, expect } from "@playwright/test";
for (const width of [1440, 390]) {
  test(`app launcher lists PDF templates and separates login at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/api/account/me", (route) =>
      route.fulfill({ json: { available: true, authenticated: false } }),
    );
    await page.goto("/");
    const launcher = page.getByLabel("แอป DocNori", { exact: true });
    await launcher.click();
    const panel = page.locator(".account-menu-panel");
    await expect(
      panel.getByRole("link", { name: "แม่แบบ PDF", exact: true }),
    ).toHaveAttribute("href", "/templates");
    await expect(
      panel.getByRole("link", { name: "เข้าสู่ระบบ", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: `artifacts/app-launcher-${width}.png` });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
    await expect(launcher).toBeFocused();
    await launcher.click();
    await panel.getByRole("link", { name: "แม่แบบ PDF", exact: true }).click();
    await expect(page).toHaveURL("/templates");
  });
}
test("signed-in launcher opens private templates and closes on outside click", async ({
  page,
}) => {
  await page.route("**/api/account/me", (route) =>
    route.fulfill({
      json: {
        available: true,
        authenticated: true,
        email: "owner@example.test",
      },
    }),
  );
  await page.goto("/");
  await page.getByLabel("แอป DocNori", { exact: true }).click();
  await expect(page.locator("[data-template-app]")).toHaveAttribute(
    "href",
    "/workspace/templates",
  );
  await expect(page.locator("[data-account-email]")).toHaveText(
    "owner@example.test",
  );
  await expect(page.locator("[data-account-logout]")).toBeVisible();
  await expect(page.locator("[data-account-login]")).toBeHidden();
  await page.locator("h1").click();
  await expect(page.locator(".account-menu")).not.toHaveAttribute("open", "");
});

test("launcher has neutral idle styling and an active state only when open", async ({
  page,
}) => {
  await page.goto("/");
  const launcher = page.getByLabel("แอป DocNori", { exact: true });
  await expect(launcher).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await launcher.click();
  await expect(launcher).toHaveCSS("background-color", "rgb(234, 246, 255)");
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0);
  await expect(launcher).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
});
