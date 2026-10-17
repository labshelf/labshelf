// Scripts the library clips: browsing folders and searching, and adding a paper by its arXiv id.
import { removePaper } from "./demoState.mjs";
import { pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

// CC BY 4.0 on arXiv, and not in the demo library.
const ARXIV_ID = "2210.11416";
const ADDED_PAPER = "chung2022scaling";

// Both takes start from the shipped nine papers.
async function openList(page, { library: root }) {
  await removePaper(root, ADDED_PAPER);
  await resetLayout(page);
  if (!(await page.locator(".part.sidebar").isVisible())) await page.locator('.activitybar [aria-label^="LabShelf"]').first().click();
  await pause(600);
  const sidebar = await webviewFrame(page, ".tree-row");
  await runCommand(page, "Research: Open List Tab", { typeDelay: 0 });
  const list = await webviewFrame(page, ".ls-library-search");
  await list.locator(".ls-library-search").fill("");
  await sidebar.locator(".tree-row", { hasText: "All papers" }).first().click();
  await pause(1500);
  return { list, sidebar };
}

export const library = {
  setup: openList,
  async take(page, pointer, { list, sidebar }) {
    await pause(900);
    await pointer.clickOn(sidebar.locator(".tree-row", { hasText: "Alignment" }).first());
    await pause(1600);
    await pointer.clickOn(sidebar.locator(".tree-row", { hasText: "All papers" }).first());
    await pause(900);
    await pointer.clickOn(list.locator(".ls-library-search"));
    await page.keyboard.type("status:reading", { delay: 85 });
    await pause(1300);
    await pointer.clickOn(list.locator(".paper-row-main", { hasText: "Constitutional AI" }), undefined, 140);
    await pause(1400);
    await pointer.park();
    await pause(2000);
  },
};

export const addPaper = {
  setup: openList,
  async take(page, pointer, { list }) {
    await pause(900);
    await runCommand(page, "Add Paper by DOI or Link");
    await pause(700);
    await page.keyboard.type(ARXIV_ID, { delay: 90 });
    await pause(600);
    await page.keyboard.press("Enter");
    await list.locator(".paper-row-main", { hasText: "Scaling Instruction" }).waitFor({ timeout: 30_000 });
    await pause(1200);
    await pointer.clickOn(list.locator(".paper-row-main", { hasText: "Scaling Instruction" }), undefined, 140);
    await pause(1400);
    await pointer.park();
    await pause(1800);
  },
};
