// Scripts the writing clips on the demo LaTeX project: cite completion, the build preview and the submission check.
import { restoreFile } from "./demoState.mjs";
import { hideSidebar, pause, resetLayout, runCommand, webviewFrame } from "./workbench.mjs";

const MAIN = "projects/llm-reasoning-notes/main.tex";

async function openMain(page, library) {
  await resetLayout(page);
  await hideSidebar(page);
  await restoreFile(library, MAIN);
  await page.keyboard.press("Meta+P");
  await pause(400);
  await page.keyboard.type("main.tex");
  await pause(500);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".monaco-editor .view-lines", { timeout: 10_000 });
  await pause(800);
}

async function goTo(page, position) {
  await page.keyboard.press("Control+G");
  await pause(250);
  await page.keyboard.type(position);
  await page.keyboard.press("Enter");
  await pause(250);
}

async function openPreview(page, library) {
  await openMain(page, library);
  await runCommand(page, "Research: Show Preview", { typeDelay: 0 });
  const preview = await webviewFrame(page, ".rd-preview-cites", 60_000);
  await preview.locator(".textLayer span").first().waitFor({ timeout: 60_000 });
  await pause(2500);
  return preview;
}

export const citeCompletion = {
  async setup(page, { library }) {
    await openMain(page, library);
    await goTo(page, "19");
    await page.keyboard.press("End");
  },
  async take(page) {
    await pause(900);
    await page.keyboard.type(" Worked examples in the prompt matter most~\\cite[", { delay: 70 });
    await pause(1600);
    await page.keyboard.type("GSM8K", { delay: 110 });
    await pause(1300);
    await page.keyboard.press("Enter");
    await pause(2600);
  },
  after: (page) => runCommand(page, "File: Revert File", { typeDelay: 0 }),
};

export const preview = {
  setup: (page, { library }) => openPreview(page, library),
  async take(page, pointer, frame) {
    await pause(800);
    await pointer.hover(frame.locator('a[href="#cite.wei2022chainofthought"]').first(), 800);
    await pause(2400);
    await page.keyboard.press("Meta+1");
    // Puts the caret right after "wang2022selfconsi" on line 24, where the missing "s" goes.
    await goTo(page, "24:49");
    await pause(700);
    await page.keyboard.type("s", { delay: 120 });
    await pause(500);
    await page.keyboard.press("Meta+S");
    await frame.locator(".rd-preview-cites", { hasNotText: "3 to fix" }).waitFor({ timeout: 60_000 });
    await pause(1600);
    await pointer.clickOn(frame.locator(".viewerContainer, #viewerContainer").first());
    await page.keyboard.press("F8");
    await pause(1600);
    await page.keyboard.press("F8");
    await pause(2000);
  },
};

export const check = {
  setup: (page, { library }) => openPreview(page, library),
  async take(page, pointer) {
    await pause(900);
    await runCommand(page, "Research: Check Before Submitting");
    await page.locator(".markers-panel .monaco-list-row").first().waitFor({ timeout: 60_000 });
    await pause(1500);
    const first = page.locator(".markers-panel .monaco-list-row", { hasText: "unresolved" }).first();
    await pointer.clickOn(first);
    await pause(3500);
  },
};
