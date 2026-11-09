import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is not set");

// Creates a room from the home page and joins it. Returns the full link, with the key.
async function createRoom(page: Page, displayName: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a room" }).click();
  await joinWithName(page, displayName);
  return page.url();
}

async function joinWithName(page: Page, displayName: string) {
  await page.getByLabel("Your name").fill(displayName);
  await page.getByRole("button", { name: "Join room" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Connected" })).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.keyboard.press("Enter");
}

async function seriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations: string[] = [];
  for (const violation of results.violations) {
    if (violation.impact === "serious" || violation.impact === "critical") {
      violations.push(`${violation.id}: ${violation.help}`);
    }
  }
  return violations;
}

test("two people chat with the full link, and a reload shows the history", async ({ page, browser }) => {
  const link = await createRoom(page, "Ada");
  const bobContext = await browser.newContext();
  const bobPage = await bobContext.newPage();
  await bobPage.goto(link);
  await joinWithName(bobPage, "Bob");

  await sendMessage(page, "Hello from Ada");
  await sendMessage(bobPage, "Hi Ada, Bob here");

  const log = (target: Page) => target.getByRole("log", { name: "Messages" });
  await expect(log(bobPage).getByText("Hello from Ada")).toBeVisible();
  await expect(log(page).getByText("Hi Ada, Bob here")).toBeVisible();

  await bobPage.reload();
  await expect(log(bobPage).getByText("Hello from Ada")).toBeVisible();
  await expect(log(bobPage).getByText("Hi Ada, Bob here")).toBeVisible();
  await bobContext.close();
});

test("a link without the key shows This link is incomplete", async ({ page, request }) => {
  const created = await request.post("/api/rooms");
  const { roomId } = await created.json();

  await page.goto(`/r/${roomId}`);

  await expect(page.getByRole("heading", { name: "This link is incomplete" })).toBeVisible();
});

test("the creator who has not copied the link is asked before leaving", async ({ page }) => {
  await createRoom(page, "Ada");

  await page.getByRole("button", { name: "Leave room" }).click();

  const dialog = page.getByRole("dialog", { name: "Save the link before you leave?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Leave anyway" }).click();
  await expect(page).toHaveURL("/");
});

test("the home page has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();

  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});

test("a room has no serious or critical accessibility violations", async ({ page }) => {
  await createRoom(page, "Ada");
  await sendMessage(page, "A message to check");
  await expect(page.getByText("A message to check")).toBeVisible();

  expect(await seriousAccessibilityViolations(page)).toEqual([]);
});
