import type { Page } from "@playwright/test";

export async function chooseDropdown(page: Page, label: string, value: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page
    .getByRole("listbox", { name: label })
    .locator(`[role="option"][data-value="${value}"]`)
    .click();
}
