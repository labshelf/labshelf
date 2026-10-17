// Scripts the reader clip: select a sentence, highlight it, copy it with its citation, then preview a reference.
import { restoreFile } from "./demoState.mjs";
import { edges, textBox } from "./textGeometry.mjs";
import { hideSidebar, pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

const SIDECAR = ".research/papers/wei2022chainofthought/data.json";
const HIGHLIGHTED = { first: "Chain-of-thought prompting has several", last: "in language models." };
const COPIED = { first: "Second, a chain of thought provides", last: "behavior of the model," };
const REFERENCE = 'a[href^="#cite.wiegreffe"]';

async function select(frame, pointer, { first, last }) {
  const start = await textBox(frame, first, { length: 1 });
  const end = await textBox(frame, last, { offset: last.length - 1, length: 1 });
  if (!start || !end) throw new Error(`reader: "${first}…${last}" is not on screen`);
  await pointer.drag(edges(start).start, edges(end).end, 1100);
  await pause(700);
}

export const reader = {
  async setup(page, { library }) {
    await resetLayout(page);
    await hideSidebar(page);
    await restoreFile(library, SIDECAR);
    await runCommand(page, "Research: Open Paper PDF", { typeDelay: 0 });
    await pause(700);
    await page.keyboard.type("Chain-of-Thought");
    await pause(500);
    await page.keyboard.press("Enter");
    const frame = await webviewFrame(page, ".textLayer span");
    await pause(3000);
    return frame;
  },
  async take(page, pointer, frame) {
    await pause(800);
    // Each bubble action closes the bubble, so the highlight and the copy each get their own selection.
    await select(frame, pointer, HIGHLIGHTED);
    await pointer.clickOn(frame.locator('button[title="Highlight yellow"]'));
    await pause(1300);
    await select(frame, pointer, COPIED);
    await pointer.clickOn(frame.locator('button[title^="Copy with citation"]'));
    await pause(1300);
    await pointer.hover(frame.locator(REFERENCE).first(), 800);
    await pause(3000);
  },
};
