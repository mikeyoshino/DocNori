import { test, expect } from "@playwright/test";

for (const tool of [
  {
    slug: "merge",
    title: "รวมไฟล์ PDF ออนไลน์ฟรี จัดลำดับไฟล์ได้ — DocNori",
    note: "บุ๊กมาร์ก",
  },
  {
    slug: "pdf-to-word",
    title: "แปลง PDF เป็น Word ออนไลน์ สำหรับแก้ไขเอกสาร — DocNori",
    note: "วรรณยุกต์",
  },
]) {
  test(`${tool.slug} serves useful guidance without JavaScript and retains metadata after hydration`, async ({
    browser,
    baseURL,
    page,
  }) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 390, height: 844 },
    });
    const staticPage = await context.newPage();
    await staticPage.goto(`${baseURL}/tools/${tool.slug}`);
    await expect(staticPage).toHaveTitle(tool.title);
    const help = staticPage.locator("[data-tool-guide]");
    await expect(help).toBeVisible();
    await expect(help.locator("ol > li")).toHaveCount(3);
    await expect(help).toContainText(tool.note);
    const description = await staticPage
      .locator('meta[name="description"]')
      .getAttribute("content");
    expect(description).toContain("25 MB");
    await expect(
      staticPage.locator('meta[property="og:title"]'),
    ).toHaveAttribute("content", tool.title);
    await expect(
      staticPage.locator('meta[property="og:description"]'),
    ).toHaveAttribute("content", description!);
    for (const summary of await help.locator("summary").all())
      await summary.click();
    expect(
      await staticPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await context.close();
    await page.goto(`/tools/${tool.slug}`);
    await expect(page.locator("[data-intro] [data-choose]")).toBeEnabled();
    await expect(page).toHaveTitle(tool.title);
  });
}
