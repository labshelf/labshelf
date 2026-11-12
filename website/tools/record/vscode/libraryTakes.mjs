// Scripts the Library section's clips: adding a paper and organizing it, then finding papers again with search.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

// CC BY 4.0 on arXiv, and not in the demo library.
const ARXIV_ID = "2210.11416";
const ADDED_PAPER = "chung2022scaling";

/** Removes the paper the organize take added, wherever the take left it (the library root or a folder it moved it to). */
async function removeAddedPaper(library) {
  const entries = await readdir(join(library, "papers"), { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(ADDED_PAPER)) await rm(join(entry.parentPath, entry.name), { recursive: true, force: true });
  }
}
const ADDED_TITLE = "Scaling Instruction";

/** A deliberate pause, a little shorter than the first draft of the takes had. */
const beat = (ms) => pause(Math.round(ms * 0.55));

/** Hides the Library's own confirmation toasts ("1 paper moved…") in every LabShelf webview, so none shows in a clip. */
async function hideToasts(page) {
  for (const frame of page.frames()) {
    if (frame.url().startsWith("vscode-webview://")) await frame.evaluate(() => {
      // A constructed stylesheet, because the webview's CSP refuses an inline <style>.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(".ls-toasts { display: none !important; }");
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }).catch(() => undefined);
  }
}

/** Keeps notifications out of the recording: clears the ones showing and stops new toasts. */
export async function silenceNotifications(page) {
  await runCommand(page, "Notifications: Clear All Notifications", { typeDelay: 0 });
  await pause(400);
  // The mode persists in the profile, so toggle it only when it is off (its status bar bell is then not crossed out).
  if ((await page.locator(".statusbar .codicon-bell-slash").count()) === 0) {
    await runCommand(page, "Notifications: Toggle Do Not Disturb Mode", { typeDelay: 0 });
    await pause(400);
  }
}

/** Right-clicks a locator with the drawn pointer, which has no right button of its own. */
async function rightClick(page, pointer, locator, fromLeft) {
  const box = await locator.boundingBox();
  const x = box.x + (fromLeft ?? box.width / 2);
  const y = box.y + box.height / 2;
  await pointer.moveTo(x, y, 600);
  await page.mouse.click(x, y, { button: "right" });
}

// Every take starts from the shipped nine papers, with the sidebar and the list tab open on All papers.
async function openList(page, { library: root }) {
  await removeAddedPaper(root);
  await resetLayout(page);
  await silenceNotifications(page);
  const icon = page.locator('.activitybar [aria-label^="LabShelf"]').first();
  await icon.waitFor({ timeout: 60_000 }).catch(async () => {
    throw new Error(`no LabShelf icon; activity bar has ${JSON.stringify(await page.locator(".activitybar .action-item a").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))))}`);
  });
  // The active container and its sidebar persist in the profile, and a second click on it would hide the sidebar.
  const showing = (await page.locator(".part.sidebar").isVisible()) && (await icon.evaluate((el) => el.closest("li")?.classList.contains("checked")));
  if (!showing) await icon.click();
  await pause(600);
  const sidebar = await webviewFrame(page, ".tree-row");
  await runCommand(page, "Research: Open List Tab", { typeDelay: 0 });
  const list = await webviewFrame(page, ".ls-library-search");
  await list.locator(".ls-library-search").fill("");
  await sidebar.locator(".tree-row", { hasText: "All papers" }).first().click();
  await pause(1500);
  await hideToasts(page);
  return { list, sidebar };
}

const organize = {
  setup: openList,
  async take(page, pointer, { list }) {
    await beat(1000);
    await runCommand(page, "Research: Add Paper by DOI or Link");
    await beat(800);
    await page.keyboard.type(ARXIV_ID, { delay: 65 });
    await beat(700);
    await page.keyboard.press("Enter");
    const row = list.locator(".paper-row-main", { hasText: ADDED_TITLE });
    await row.waitFor({ timeout: 40_000 });
    await beat(1400);
    await pointer.clickOn(row, 600, 140);
    const detail = await webviewFrame(page, ".detail-head");
    await beat(1500);
    // Reading status from the row's menu.
    await rightClick(page, pointer, row, 140);
    await beat(700);
    await pointer.clickOn(list.locator(".ls-menu-item", { hasText: "Mark as Reading" }), 600);
    await beat(1400);
    // A tag from the detail pane.
    await pointer.clickOn(detail.locator(".tag-add"), 700);
    await beat(500);
    await page.keyboard.type("instruction-tuning", { delay: 60 });
    await beat(500);
    await page.keyboard.press("Enter");
    await beat(1500);
    // Into a folder with Move to….
    await rightClick(page, pointer, row, 140);
    await beat(700);
    await pointer.clickOn(list.locator(".ls-menu-item", { hasText: "Move to…" }), 600);
    await beat(800);
    await page.keyboard.type("Foundations", { delay: 65 });
    await beat(1000);
    await page.keyboard.press("Enter");
    await beat(1800);
    await pointer.park(700);
    await beat(2200);
  },
  after: (page, { library }) => removeAddedPaper(library),
};

const find = {
  setup: openList,
  async take(page, pointer, { list, sidebar }) {
    await beat(900);
    await pointer.clickOn(sidebar.locator(".tree-row", { hasText: "Language models" }).first(), 700);
    await beat(1600);
    await pointer.clickOn(list.locator(".ls-library-search"), 700);
    await page.keyboard.type("author:wei status:reading", { delay: 60 });
    await beat(1800);
    await list.locator(".ls-library-search").fill("");
    await beat(500);
    await page.keyboard.type("tag:to-cite", { delay: 60 });
    await beat(1800);
    await pointer.clickOn(list.locator(".paper-row-main").first(), 700, 140);
    const detail = await webviewFrame(page, ".detail-head");
    await beat(1800);
    await pointer.clickOn(detail.locator("button.open-btn"), 700);
    await beat(3500);
  },
};

export const LIBRARY_TAKES = { organize, find };
