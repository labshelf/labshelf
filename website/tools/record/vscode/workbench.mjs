// Frames the workbench page at the recording size and runs commands through the command palette, as a user would.
import { WINDOW } from "./host.mjs";

export const SCALE = 2;
export const pause = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Renders the workbench at the recording size whatever the real window is, and keeps it so while the session lives.
 * PLATFORM: VS Code places a development host beside the last window and Electron's CDP cannot resize it.
 */
export async function frameWorkbench(page) {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setDeviceMetricsOverride", { ...WINDOW, deviceScaleFactor: SCALE, mobile: false });
  await pause(800);
  await relayout(page);
  return session;
}

/** Opens the command palette, types `query` and runs the first match. */
export async function runCommand(page, query, { typeDelay = 45 } = {}) {
  await page.keyboard.press("Meta+Shift+P");
  await page.waitForSelector(".quick-input-widget:not([style*='display: none']) input", { timeout: 5000 });
  await pause(250);
  await page.keyboard.type(query, { delay: typeDelay });
  await pause(450);
  await page.keyboard.press("Enter");
}

// TRAP: a layout pass the workbench ran before the viewport override keeps the window's real width.
const relayout = async (page) => { await page.evaluate(() => window.dispatchEvent(new Event("resize"))); await pause(300); };

/** Closes every editor and the panel so each take starts from the same empty layout. */
export async function resetLayout(page) {
  await page.keyboard.press("Escape");
  await runCommand(page, "View: Close All Editors", { typeDelay: 0 });
  await pause(300);
  if (await page.locator(".part.panel").isVisible()) await page.keyboard.press("Meta+J");
  await relayout(page);
}

/** Returns the inner frame of the webview whose document has `selector`. */
export async function webviewFrame(page, selector, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      if (!frame.url().startsWith("vscode-webview://")) continue;
      if (await frame.$(selector).catch(() => null)) return frame;
    }
    await pause(250);
  }
  throw new Error(`no webview has ${selector} after ${timeout} ms`);
}

/** Hides the primary side bar, giving the editors the whole width. */
export async function hideSidebar(page) {
  if (await page.locator(".part.sidebar").isVisible()) await page.keyboard.press("Meta+B");
  await relayout(page);
}
