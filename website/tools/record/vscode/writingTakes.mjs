// Scripts the writing clips on the demo project's manuscript: citing and inserting an equation, fixing references, checking before submitting.
import { restoreFile } from "./demoState.mjs";
import { hideSidebar, pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

const PROJECT = "projects/llm-reasoning-notes";
const NOTE = `${PROJECT}/notes/chain-of-thought-and-scale.qmd`;
const SHOTS = process.env.SHOTS;
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : undefined);

/** Opens main.tex (in the LabShelf Editor, or the text editor), with the PDF preview beside it when `preview`, built so its chip counts the citations. */
function openManuscript({ preview = true, textEditor = false } = {}) {
  return async (page, { library }) => {
    await resetLayout(page);
    await hideSidebar(page);
    await restoreFile(library, `${PROJECT}/main.tex`);
    await restoreFile(library, NOTE);
    await page.keyboard.press("Meta+P");
    await pause(400);
    await page.keyboard.type("main.tex");
    await pause(700);
    await page.keyboard.press("Enter");
    // The window remembers an earlier "Reopen Editor With": start from the LabShelf Editor whatever it chose.
    await page.waitForSelector(".monaco-editor .view-line, iframe.webview", { timeout: 20_000 });
    await pause(2500);
    if (await page.locator(".monaco-editor .view-line").first().isVisible()) await reopenWith(page, "LabShelf Editor");
    const editor = await webviewFrame(page, ".cm-editor", 30_000);
    await pause(1500);
    let previewFrame;
    if (preview) {
      await runCommand(page, "Research: Show Preview");
      previewFrame = await webviewFrame(page, ".rd-preview-cites", 120_000);
      await previewFrame.getByText("Recompile").first().click();
      for (let i = 0; i < 60; i += 1) {
        if (/to fix/.test(await previewFrame.locator(".rd-preview-cites").first().innerText().catch(() => ""))) break;
        await pause(2000);
      }
    }
    if (textEditor) await reopenAsText(page);
    await runCommand(page, "Notifications: Clear All Notifications", { typeDelay: 0 });
    // Do Not Disturb keeps the information toasts out of the clip.
    // The mode outlives the window, so it is only switched on when the status bar bell is not already struck through.
    if (!(await page.locator(".statusbar .codicon-bell-slash").count())) await runCommand(page, "Notifications: Toggle Do Not Disturb Mode", { typeDelay: 0 });
    await pause(1500);
    return { editor, preview: previewFrame };
  };
}

/** Switches the focused editor from the LabShelf Editor to VS Code's own text editor. */
const reopenAsText = async (page) => {
  await reopenWith(page, "Text Editor");
  await page.waitForSelector(".monaco-editor .view-line", { timeout: 15_000 });
  await pause(1200);
};

async function reopenWith(page, editorName) {
  await runCommand(page, "View: Reopen Editor With...", { typeDelay: 0 });
  await pause(800);
  await page.keyboard.type(editorName, { delay: 30 });
  await pause(500);
  await page.keyboard.press("Enter");
  await pause(1500);
}

/** Types into the focused editor at a readable pace. */
const typeSlowly = (page, text) => page.keyboard.type(text, { delay: 70 });

async function clickEndOfLine(pointer, page, locator) {
  await pointer.clickOn(locator.first(), 700);
  await page.keyboard.press("End");
}

const manuscript = {
  setup: openManuscript(),
  async take(page, pointer, { editor }) {
    await pause(1500);
    await clickEndOfLine(pointer, page, editor.locator(".cm-line", { hasText: "principles can replace" }));
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await typeSlowly(page, "The gain appears only in sufficiently large models");
    await typeSlowly(page, " \\cite{wei");
    await pause(1300);
    await shot(page, "m1");
    await page.keyboard.press("Enter");
    await pause(1500);
    await shot(page, "m2");
    // The list offers the paper, a page, and each highlight; the quoted highlight is the third row down.
    for (let i = 0; i < 3; i += 1) { await page.keyboard.press("ArrowDown"); await pause(450); }
    await shot(page, "m3");
    await pause(700);
    await page.keyboard.press("Enter");
    await pause(1200);
    await page.keyboard.press("End");
    await typeSlowly(page, ".");
    await pause(900);
    await shot(page, "m4");
    await page.keyboard.press("Meta+S");
    await pause(1500);
    await pointer.moveTo(1850, 560, 900);
    await pause(8000);
    await shot(page, "m8");
  },
  posterAt: undefined,
};

const references = {
  setup: openManuscript(),
  async take(page, pointer, { editor, preview }) {
    await pause(1500);
    await pointer.hover(preview.locator(".rd-preview-cites").first(), 900);
    await pause(2200);
    const line = editor.locator(".cm-line", { hasText: "wang2022selfconsitency" }).first();
    const word = editor.locator(".cm-line", { hasText: "wang2022selfconsitency" }).first().locator(".tok-variableName, span", { hasText: "wang2022selfconsitency" }).last();
    await shot(page, "r1");
    const box = await word.boundingBox();
    await pointer.moveTo(box.x + box.width / 2, box.y + box.height / 2, 900);
    await pause(700);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await pause(900);
    await page.keyboard.type("wang2022selfconsistency", { delay: 75 });
    await pause(1200);
    await page.keyboard.press("Escape");
    await shot(page, "r2");
    await page.keyboard.press("Meta+S");
    await pause(2000);
    await pointer.hover(preview.locator(".rd-preview-cites").first(), 900);
    await pause(9000);
    await shot(page, "r3");
  },
};

const check = {
  setup: openManuscript({ preview: false, textEditor: true }),
  async take(page, pointer) {
    await pause(1500);
    await pointer.clickOn(page.locator(".monaco-editor .view-line").nth(8), 600, 200);
    await pause(1200);
    await runCommand(page, "Research: Check Before Submitting", { typeDelay: 45 });
    await pause(4500);
    const row = page.locator(".part.panel .monaco-list-row", { hasText: "is not in any bibliography" }).first();
    await pointer.clickOn(row, 900, 300);
    await pause(4500);
    await shot(page, "c1");
  },
};

export const WRITING_TAKES = { manuscript, references, check };
