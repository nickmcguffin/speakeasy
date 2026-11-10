import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { deleteRooms } from "../deleteRooms";

test.skip(!process.env.TEST_DATABASE_URL, "TEST_DATABASE_URL is not set");

const createdRoomIds: string[] = [];

test.afterAll(() => deleteRooms(createdRoomIds));

// Creates a room from the home page and joins it. Returns the full link, with the key.
async function createRoom(page: Page, displayName: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create a room" }).click();
  await joinWithName(page, displayName);
  const link = page.url();
  createdRoomIds.push(new URL(link).pathname.replace("/r/", ""));
  return link;
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

type ColorScheme = "light" | "dark";

// The page background in each theme (the bg token), to check that the theme is the one asked for.
const pageBackgrounds: Record<ColorScheme, string> = { light: "rgb(232, 237, 233)", dark: "rgb(18, 24, 21)" };

// Axe measures colours as they are on screen, so a row part way through its slide-in (opacity
// below 1) or a colour transition gives a contrast the finished page does not have.
async function waitForAnimationsToFinish(page: Page) {
  await page.waitForFunction(() => {
    for (const animation of document.getAnimations()) {
      if (animation.playState === "running") {
        return false;
      }
    }
    return true;
  });
}

async function expectNoSeriousViolations(page: Page, colorScheme: ColorScheme) {
  await expect(page.locator("body")).toHaveCSS("background-color", pageBackgrounds[colorScheme]);
  await waitForAnimationsToFinish(page);
  const results = await new AxeBuilder({ page }).analyze();
  // One line per failing element: the rule, the element (its selector and opening tag, without its
  // text) and, for contrast, the colours axe measured.
  const violations: string[] = [];
  for (const violation of results.violations) {
    if (violation.impact !== "serious" && violation.impact !== "critical") {
      continue;
    }
    for (const node of violation.nodes) {
      const openingTag = node.html.slice(0, node.html.indexOf(">") + 1);
      let line = `${violation.id} at ${node.target.join(" ")} ${openingTag}`;
      for (const check of node.any) {
        const contrast = check.data;
        if (contrast?.contrastRatio !== undefined) {
          line += `: ${contrast.fgColor} on ${contrast.bgColor} is ${contrast.contrastRatio}:1, expected ${contrast.expectedContrastRatio}`;
        }
      }
      violations.push(line);
    }
  }
  expect(violations).toEqual([]);
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
  createdRoomIds.push(roomId);

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

// The theme follows the system setting until the user picks one, so the emulated setting picks it.
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("the home page has no serious or critical violations", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Create a room" })).toBeVisible();

      await expectNoSeriousViolations(page, colorScheme);
    });

    test("the empty room with the share panel has no serious or critical violations", async ({ page }) => {
      await createRoom(page, "Ada");
      await expect(page.getByRole("region", { name: "Share this room" })).toBeVisible();

      await expectNoSeriousViolations(page, colorScheme);
    });

    test("the open leave dialog has no serious or critical violations", async ({ page }) => {
      await createRoom(page, "Ada");
      await page.getByRole("button", { name: "Leave room" }).click();
      await expect(page.getByRole("dialog", { name: "Save the link before you leave?" })).toBeVisible();

      await expectNoSeriousViolations(page, colorScheme);
    });

    test("a room with a message has no serious or critical violations", async ({ page }) => {
      await createRoom(page, "Ada");
      await sendMessage(page, "A message to check");
      await expect(page.getByText("A message to check")).toBeVisible();
      // Sent: the server confirmed it, so the row shows its final state.
      await expect(page.getByText("Sending...")).toHaveCount(0);

      await expectNoSeriousViolations(page, colorScheme);
    });
  });
}
