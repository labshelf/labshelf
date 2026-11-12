// Scripts the Reading section's clips: a thought noted on a sentence, and a reference previewed without leaving the page.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { restoreFile } from "./demoState.mjs";
import { silenceNotifications } from "./libraryTakes.mjs";
import { edges, textBox } from "./textGeometry.mjs";
import { hideSidebar, pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

const PAPER = "wei2022chainofthought";
const PAPER_DIR = "papers/Language models/Reasoning/wei2022chainofthought";
const SIDECAR = `.research/papers/${PAPER}/data.json`;
const SENTENCE = { first: "Chain-of-thought prompting has several", last: "in language models." };
const QUOTED = { first: "Second, a chain of thought provides", last: "behavior of the model," };
const REFERENCE = 'a[href^="#cite.wiegreffe"]';
const THOUGHT = "Cite this for the emergence-with-scale claim.";

/** A deliberate pause, shorter than the first draft's. */
const beat = (ms) => pause(Math.round(ms * 0.6));

async function select(frame, pointer, { first, last }) {
  const start = await textBox(frame, first, { length: 1 });
  const end = await textBox(frame, last, { offset: last.length - 1, length: 1 });
  if (!start || !end) throw new Error(`reader: "${first}…${last}" is not on screen`);
  await pointer.drag(edges(start).start, edges(end).end, 1100);
  await beat(700);
}

// Both takes start from the paper's shipped highlights and no notes of the reader's own.
async function openPaper(page, { library }) {
  await resetLayout(page);
  await hideSidebar(page);
  await silenceNotifications(page);
  await restoreFile(library, SIDECAR);
  await rm(join(library, PAPER_DIR, "notes.qmd"), { force: true });
  await runCommand(page, "Research: Open Paper PDF", { typeDelay: 0 });
  await pause(700);
  await page.keyboard.type("Chain-of-Thought");
  await pause(500);
  await page.keyboard.press("Enter");
  const frame = await webviewFrame(page, ".textLayer span");
  await pause(3000);
  return frame;
}

const note = {
  setup: openPaper,
  async take(page, pointer, frame) {
    await beat(1000);
    await select(frame, pointer, SENTENCE);
    await frame.locator("#selection-toolbar.rd-visible").waitFor({ timeout: 5000 });
    await beat(900);
    await pointer.clickOn(frame.locator('#selection-toolbar button[aria-label="Add to note"]'), 700);
    await frame.locator(".rd-floating-note").waitFor({ timeout: 10_000 });
    await beat(1500);
    await page.keyboard.type(THOUGHT, { delay: 55 });
    await beat(1500);
    await page.keyboard.press("Escape");
    await beat(1200);
    await frame.locator("button.rd-note-pin").first().waitFor({ timeout: 5000 });
    await pointer.hover(frame.locator("button.rd-note-pin").first(), 800);
    await beat(1800);
    await pointer.clickOn(frame.locator('button.rd-tab[title="Notes"]'), 800);
    await beat(3000);
  },
  after: (page, { library }) => rm(join(library, PAPER_DIR, "notes.qmd"), { force: true }),
};

const reference = {
  setup: openPaper,
  async take(page, pointer, frame) {
    await beat(1000);
    await pointer.hover(frame.locator(REFERENCE).first(), 900);
    await frame.locator("#hover-popup").waitFor({ timeout: 5000 });
    await beat(3800);
    await select(frame, pointer, QUOTED);
    await pointer.clickOn(frame.locator('#selection-toolbar button[aria-label="Cite…"]'), 700);
    await beat(1200);
    await pointer.clickOn(frame.locator(".rd-menu-item", { hasText: "Copy with citation" }), 700);
    await beat(2200);
  },
};

export const READING_TAKES = { note, reference };
