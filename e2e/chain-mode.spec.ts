import path from "node:path";
import { expect, test } from "@playwright/test";

test("reference clicks follow forward and inverse refs stay behind a toggle", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles(path.join(import.meta.dirname, "fixtures", "sample.ifc"));

  await expect(page.getByText("IFC2X3")).toBeVisible();
  await page.getByLabel("Filter").fill("#9");
  await page.keyboard.press("Enter");
  await page.getByTitle("Save query").click();
  await page.getByRole("button", { name: /^Reset$/ }).first().click();
  await page.locator('.saved-row button[title="#9"]').click();

  await page.locator(".cm-ifc-reference", { hasText: "#5" }).first().click();

  await expect(page.getByTestId("chain-panel")).toContainText("#5");
  await expect(page.getByTestId("incoming-list")).toHaveCount(0);
  await expect(page.getByText("#5", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".cm-content")).toContainText("#5=IFCOWNERHISTORY");
  await expect(page.locator(".cm-content")).toContainText("#9=IFCWALL");

  await page.getByTestId("incoming-toggle").click();
  await expect(page.getByTestId("incoming-list")).toContainText("#9=IFCWALL");

  await page.locator(".cm-ifc-reference", { hasText: "#4" }).first().click();
  await expect(page.getByTestId("chain-panel")).toContainText("#4");
});
