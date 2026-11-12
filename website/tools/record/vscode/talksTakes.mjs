// Scripts the talks and posters clips: a figure placed and resized on a slide, then the talk presented.
import { restoreFolder } from "./demoState.mjs";
import { hideSidebar, pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

const TALKS = "projects/llm-reasoning-notes/talks";
const POSTERS = "projects/llm-reasoning-notes/posters";

/** Opens a deck's deck.html in the LabShelf deck editor and returns the editor's frame. */
async function openDeck(page, library, path) {
  await restoreFolder(library, TALKS);
  await restoreFolder(library, POSTERS);
  // A deck editor restored from the last session holds the keyboard focus; focus the status bar so the palette opens.
  await page.mouse.click(900, 889);
  await resetLayout(page);
  await hideSidebar(page);
  // The iCloud toast of a fresh profile arrives a few seconds after launch; clear it before the clip starts.
  await pause(4500);
  await runCommand(page, "Notifications: Clear All Notifications", { typeDelay: 0 });
  await pause(600);
  await page.keyboard.press("Meta+P");
  await pause(400);
  await page.keyboard.type(path);
  await pause(700);
  await page.keyboard.press("Enter");
  const deck = await webviewFrame(page, ".dw-header", 20_000);
  await deck.locator(".deck-editor-stage").first().waitFor();
  await pause(1500);
  return deck;
}

export const slide = {
  setup: (page, { library }) => openDeck(page, library, "self-consistency/deck.html"),
  async take(page, pointer, deck) {
    await pause(1800);
    await pointer.clickOn(deck.locator(".deck-editor-strip-option").nth(1));
    await pause(1600);
    const figure = deck.locator('.deck-editor-box[data-block-box="accuracy"]');
    const box = await figure.boundingBox();
    await pointer.drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 - 130, y: box.y + box.height / 2 - 150 }, 1100);
    await pause(900);
    const handle = deck.locator('.deck-editor-handle[data-handle="se"]');
    const corner = await handle.boundingBox();
    await pointer.drag({ x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }, { x: corner.x + corner.width / 2 + 70, y: corner.y + corner.height / 2 + 55 }, 1000);
    await pause(1200);
    const heading = deck.locator('.deck-editor-box[data-block-box="results-heading"]');
    await heading.dblclick();
    await pause(500);
    await page.keyboard.press("Meta+A");
    await page.keyboard.type("Sampling and voting beat greedy decoding", { delay: 55 });
    await pause(900);
    await pointer.click(900, 712);
    await pause(1200);
    await pointer.park();
    await pause(2400);
  },
};

/** The centre of a poster gap handle (kind "column" or "section", and its index and column), in page px. */
async function gapCentre(deck, kind, index, column) {
  const box = await deck.locator(`.dsh-poster-gap[data-gap-kind="${kind}"][data-gap-index="${index}"][data-gap-column="${column}"]`).boundingBox();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export const poster = {
  setup: (page, { library }) => openDeck(page, library, "posters/self-consistency/deck.html"),
  async take(page, pointer, deck) {
    await pause(900);
    // The figure sits in a narrow side column: drag its section under the main finding, in the wide middle column.
    const figure = await deck.locator('.deck-editor-box[data-block-box="key-figure"]').boundingBox();
    const finding = await deck.locator('.deck-editor-box[data-block-box="main-finding"]').boundingBox();
    const grab = { x: figure.x + figure.width / 2, y: figure.y + 30 };
    await pointer.moveTo(grab.x, grab.y, 600);
    await pause(300);
    await pointer.drag(grab, { x: finding.x + finding.width / 2, y: finding.y + finding.height * 0.8 }, 1300);
    await pause(1000);
    // The finding needs little height: drag the gap under it up to give the figure room.
    const columnGap = await gapCentre(deck, "section", 0, 1);
    await pointer.moveTo(columnGap.x, columnGap.y, 500);
    await pause(250);
    await pointer.drag(columnGap, { x: columnGap.x, y: columnGap.y - 60 }, 900);
    await pause(900);
    await pointer.clickOn(deck.locator("button", { hasText: "Preview" }).first());
    await pause(2200);
    await runCommand(page, "View: Toggle Maximize Editor Group", { typeDelay: 25 });
    await pause(1000);
    // The preview fits the poster once, when it opens: Cmd and the wheel zoom it to the full height, a drag centres it.
    const preview = await webviewFrame(page, ".ls-poster-zoom", 10_000);
    await page.mouse.move(283, 477);
    await page.keyboard.down("Meta");
    for (let i = 0; i < 8; i += 1) {
      if (parseInt(await preview.locator(".ls-poster-zoom").first().innerText(), 10) >= 17) break;
      await page.mouse.wheel(0, -40);
      await pause(200);
    }
    await page.keyboard.up("Meta");
    await pause(600);
    await pointer.drag({ x: 283, y: 700 }, { x: 640, y: 700 }, 800);
    await pause(700);
    await pointer.park();
    await pause(2200);
  },
};

export const TALKS_TAKES = { slide, poster };
