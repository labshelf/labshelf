// Scripts the Spaces clips: gathering a research question's papers, notes and project, and a discussion that turns into a task.
import { utimes } from "node:fs/promises";
import { join } from "node:path";
import { restoreFolder } from "./demoState.mjs";
import { hideSidebar, pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

/** Opens the Spaces catalogue and then the Space titled `title`, returning the Space page's frame. */
async function openSpace(page, library, title) {
  await restoreFolder(library, "spaces");
  // The notes list shows the file's modified time, so the seeded files carry the dates of the story.
  const when = new Date("2026-10-14T16:20:00Z");
  await utimes(join(library, "spaces/reasoning-question/notes/where-to-start.qmd"), when, when).catch(() => {});
  await utimes(join(library, "spaces/self-consistency-review/discussions/sampling-budget.qmd"), new Date("2026-10-22T08:47:00Z"), new Date("2026-10-22T08:47:00Z")).catch(() => {});
  await resetLayout(page);
  await hideSidebar(page);
  // The iCloud toast of a fresh profile arrives a few seconds after launch; clear it before the clip starts.
  await pause(4500);
  await runCommand(page, "Notifications: Clear All Notifications", { typeDelay: 0 });
  await pause(600);
  await runCommand(page, "LabShelf: All Spaces", { typeDelay: 0 });
  const catalog = await webviewFrame(page, ".catalog-title");
  await pause(600);
  await catalog.locator(".catalog-title", { hasText: title }).click();
  const space = await webviewFrame(page, ".ls-page-tab");
  await pause(1200);
  return space;
}

const tab = (space, name) => space.locator(`.ls-page-tab[data-tab=${name}]`);

export const gather = {
  setup: (page, { library }) => openSpace(page, library, "How do language models reason?"),
  async take(page, pointer, space) {
    await pause(1400);
    await pointer.clickOn(tab(space, "papers"));
    await pause(1200);
    await pointer.clickOn(space.locator("button", { hasText: "Add papers" }).first());
    await pause(900);
    const search = space.locator('input[aria-label="Search Library papers"]');
    for (const [query, title] of [["self-consistency", "Self-Consistency"], ["react", "ReAct"]]) {
      await pointer.clickOn(search);
      await search.fill("");
      await page.keyboard.type(query, { delay: 80 });
      await pause(700);
      await pointer.clickOn(space.locator("label.pp-pick", { hasText: title }));
      await pause(500);
    }
    await pointer.clickOn(space.locator("form.ls-dialog button", { hasText: "Add" }).last());
    await pause(1500);
    await pointer.clickOn(tab(space, "notes"));
    await pause(1200);
    await pointer.clickOn(space.getByText("Where to start").first());
    await pause(2000);
    await pointer.clickOn(tab(space, "overview"));
    await pause(900);
    await pointer.clickOn(space.locator("button", { hasText: "Link" }).last());
    await pause(900);
    await pointer.clickOn(space.locator(".ls-quick-item", { hasText: "llm-reasoning-notes" }));
    await pause(2000);
    await pointer.park();
    await pause(600);
  },
};

export const discuss = {
  async setup(page, { library }) {
    const space = await openSpace(page, library, "Does self-consistency still help?");
    await tab(space, "discussions").click();
    await space.locator(".ds-row").first().waitFor();
    await pause(800);
    return space;
  },
  async take(page, pointer, space) {
    await pause(1500);
    await pointer.clickOn(space.locator(".ds-row").first());
    await pause(2600);
    const bruno = space.locator("article.ds-message", { hasText: "I can run that" });
    await pointer.hover(bruno, 700);
    await pause(700);
    await pointer.clickOn(bruno.locator('.ds-msg-action[aria-label="Create task"]'));
    const form = space.locator('form[aria-label="Create task"]');
    await form.waitFor();
    await pause(700);
    await pointer.clickOn(form.locator('[name="title"]'));
    await page.keyboard.press("Meta+A");
    await page.keyboard.type("Run the 5-path comparison on the dev set", { delay: 45 });
    const assignee = form.locator('[name="assignee"]');
    await pointer.hover(assignee, 500);
    if ((await assignee.evaluate((el) => el.tagName)) === "SELECT") await assignee.selectOption({ label: "Bruno" });
    else { await assignee.click(); await page.keyboard.type("Bruno", { delay: 70 }); }
    await form.locator('[name="date"]').fill("2026-11-20");
    await pause(900);
    await pointer.clickOn(form.locator("button", { hasText: "Save" }));
    await pause(1800);
    await pointer.park();
    await pause(2200);
  },
};

export const SPACES_TAKES = { gather, discuss };
