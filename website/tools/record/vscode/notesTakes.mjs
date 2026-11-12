// Scripts the notes clips on the demo project's chain-of-thought note: reading it, then computing in it.
import { restoreFile } from "./demoState.mjs";
import { edges, textBox } from "./textGeometry.mjs";
import { hideSidebar, pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

const NOTE = "projects/llm-reasoning-notes/notes/chain-of-thought-and-scale.qmd";

async function openNote(page, { library }) {
  await resetLayout(page);
  await hideSidebar(page);
  await runCommand(page, "Notifications: Clear All Notifications", { typeDelay: 0 });
  await restoreFile(library, NOTE);
  await page.keyboard.press("Meta+P");
  await pause(400);
  await page.keyboard.type("chain-of-thought-and-scale");
  await pause(600);
  await page.keyboard.press("Enter");
  const note = await webviewFrame(page, ".qmd-note-file");
  await note.locator(".qmd-param-range").first().waitFor({ timeout: 30_000 });
  await pause(2500);
  // The Advanced switch is remembered per note, and the clips start from the clean view.
  if (await note.locator(".qmd-cell-code").first().isVisible()) await note.locator(".qmd-note-advanced").click();
  await pause(1500);
  return note;
}

/** Scrolls a webview's scroller (its first scrollable ancestor of the note) by `delta` pixels, eased over `ms`. */
async function scrollBy(frame, delta, ms = 1400) {
  await frame.evaluate(({ delta, ms }) => new Promise((done) => {
    let el = document.querySelector(".qmd-note-file, .viewerContainer, #viewerContainer") ?? document.body;
    while (el && el !== document.documentElement && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    el = el ?? document.scrollingElement;
    const from = el.scrollTop;
    const t0 = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      el.scrollTop = from + delta * (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
      if (t < 1) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  }), { delta, ms });
}

export const note = {
  setup: openNote,
  async take(page, pointer, frame) {
    await pause(1800);
    await pointer.moveTo(1300, 560, 700);
    await scrollBy(frame, 420, 2200);
    await pause(1800);
    await scrollBy(frame, -420, 1600);
    await pause(900);
    await pointer.clickOn(frame.locator('a[href^="labshelf:wei2022chainofthought"]').first());
    const reader = await webviewFrame(page, ".textLayer span");
    await reader.locator(".textLayer span").first().waitFor({ timeout: 20_000 });
    await pause(1800);
    // The reader opens on the page; the passage sits at its foot.
    await scrollBy(reader, 620, 1800);
    await pause(700);
    const first = "does not positively";
    const last = "100B parameters.";
    const start = await textBox(reader, first, { length: 1 });
    const end = await textBox(reader, last, { offset: last.length - 1, length: 1 });
    if (!start || !end) throw new Error("note: the quoted passage is not on screen in the reader");
    await pointer.drag(edges(start).start, edges(end).end, 1300);
    await pause(3800);
  },
};

export const run = {
  setup: openNote,
  async take(page, pointer, frame) {
    await pause(1500);
    await pointer.clickOn(frame.locator(".qmd-note-advanced"));
    await pause(1800);
    await pointer.moveTo(1300, 560, 600);
    await scrollBy(frame, 460, 1800);
    await pause(1500);
    const range = frame.locator(".qmd-param-range").first();
    const box = await range.boundingBox();
    const at = (value) => ({ x: box.x + 8 + ((value - 30) / 570) * (box.width - 16), y: box.y + box.height / 2 });
    await pointer.drag(at(150), at(330), 1500);
    await pause(3500);
    await pointer.drag(at(330), at(90), 1500);
    await pause(3500);
  },
};

export const NOTES_TAKES = { note, run };
