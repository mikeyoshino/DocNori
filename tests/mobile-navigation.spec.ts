import { chromium, webkit, expect, test } from "@playwright/test";

for (const browserName of ["chromium", "webkit"] as const) {
  test.describe(`${browserName} mobile touch navigation`, () => {
    for (const menu of ["direct", "organize", "convert", "all"] as const) {
      test(`${menu} links navigate from home and tool pages`, async ({
        baseURL,
      }) => {
        const browser = await { chromium, webkit }[browserName].launch();
        const page = await browser.newPage({
          baseURL,
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        });
        try {
          await page.goto("/");
          for (const source of ["home", "tool"]) {
            // Tool pages replace their SSR markup when WASM is ready.
            if (source === "tool")
              await expect(
                page.locator(".tool-file-drop [data-choose]"),
              ).toBeEnabled();
            await page
              .getByRole("button", { name: "เปิดเมนูเครื่องมือ" })
              .tap();
            const nav = page.getByRole("navigation", {
              name: "เมนูหลัก",
              exact: true,
            });
            let link = nav.locator(
              'a.primary-nav-link[href="/tools/compress"]',
            );
            let destination = "/tools/compress";
            if (menu === "organize") {
              await nav.locator(".nav-organize summary").tap();
              link = nav.locator(
                '.organize-nav-dropdown a[href="/tools/organize"]',
              );
              destination = "/tools/organize";
            } else if (menu === "convert") {
              await nav
                .locator("summary")
                .filter({ hasText: "แปลง PDF" })
                .tap();
              link = nav.locator(
                '.convert-dropdown a[href="/tools/jpg-to-pdf"]',
              );
              destination = "/tools/jpg-to-pdf";
            } else if (menu === "all") {
              await nav
                .locator("summary")
                .filter({ hasText: "เครื่องมือทั้งหมด" })
                .tap();
              link = nav.locator(
                '.all-tools-dropdown a[href="/tools/compress-image"]',
              );
              destination = "/tools/compress-image";
            }
            await link.tap();
            await expect(page, `navigate from ${source}`).toHaveURL(
              new RegExp(`${destination}$`),
            );
            await expect(
              page.getByRole("button", { name: "เปิดเมนูเครื่องมือ" }),
            ).toBeVisible();
            await expect(nav).toBeHidden();
          }
        } finally {
          await browser.close();
        }
      });
    }
  });
}
