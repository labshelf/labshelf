// Records the browser extension saving an arXiv paper from its popup into the library page, as website/media/browser/capture.
// Usage: node website/tools/record/browser.mjs <scratch dir>   (run `pnpm --filter @labshelf/browser build:chrome` first)
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { overlayPopup } from "./browser/composite.mjs";
import { startScreencast } from "./screencast.mjs";
import { seedLibrary } from "./browser/seed.mjs";
import { encodeClip, framesToVideo } from "./encode.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const extension = join(repo, "packages/browser/dist/chrome");
const chrome = join(homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
// CC BY 4.0 on its abstract page, and not in the demo library.
const ARTICLE = "https://arxiv.org/abs/2210.11416";
const TARGET_FOLDER = "papers/Language models/Foundations";
const TAGS = "instruction-tuning";
const SCALE = 2;
const PAGE = { width: 1280, height: 800 };
const POPUP = { width: 340, height: 300 };

const scratch = process.argv[2];
if (!scratch) {
  console.error("Usage: node browser.mjs <scratch dir>");
  process.exit(2);
}
const framesDir = join(scratch, "frames");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const device = (size) => ({ width: size.width * SCALE, height: size.height * SCALE });

async function launch() {
  const profile = join(scratch, "profile");
  await rm(profile, { recursive: true, force: true });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chrome,
    headless: false,
    // PLATFORM: the screencast ignores emulated device metrics and sends frames at the window's own scale.
    args: ["--headless=new", `--force-device-scale-factor=${SCALE}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    viewport: PAGE,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
    env: { ...process.env, XDG_CONFIG_HOME: join(scratch, "config"), XDG_CACHE_HOME: join(scratch, "cache"), LABSHELF_TOKEN_STORE: "file" },
  });
  const worker = context.serviceWorkers().find((w) => w.url().endsWith("/background/index.js"))
    ?? await context.waitForEvent("serviceworker", { predicate: (w) => w.url().endsWith("/background/index.js") });
  return { context, worker, extensionId: new URL(worker.url()).host };
}

// The popup runs as a tab page, so "the active tab" it asks Chrome for is pinned to the article tab.
async function openPopup(context, articleTab) {
  const popup = await context.newPage();
  await popup.setViewportSize(POPUP);
  await popup.addInitScript((tab) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (_info, callback) => {
      const found = query({ url: tab.url }).then((tabs) => tabs.filter((t) => t.id === tab.id));
      if (callback) void found.then(callback);
      return found;
    };
  }, articleTab);
  return popup;
}

async function recordSave(context, worker, extensionId) {
  const article = context.pages()[0] ?? await context.newPage();
  await article.emulateMedia({ colorScheme: "light" });
  await article.goto(ARTICLE, { waitUntil: "networkidle" });
  const articleTab = await worker.evaluate(async (url) => (await chrome.tabs.query({ url })).map((t) => ({ id: t.id, url: t.url }))[0], ARTICLE);
  if (!articleTab) throw new Error(`browser: no tab for ${ARTICLE}`);

  const pageCast = await startScreencast(article, framesDir, "page", device(PAGE));
  await pause(2000);
  const popup = await openPopup(context, articleTab);
  const popupCast = await startScreencast(popup, framesDir, "popup", device(POPUP));
  await popup.goto(`chrome-extension://${extensionId}/popup/index.html`);
  await popup.waitForSelector('#popup[data-state="form"]', { timeout: 30_000 });
  await popup.waitForFunction(() => !document.querySelector("#pdf")?.textContent?.match(/search/i), null, { timeout: 30_000 });
  await popup.selectOption("#folder", TARGET_FOLDER).catch((err) => console.warn(`browser: folder ${TARGET_FOLDER} not offered: ${err.message}`));
  await pause(1000);
  await popup.click("#tags");
  await popup.keyboard.type(TAGS, { delay: 90 });
  await pause(700);
  await popup.click("#save");
  await popup.waitForSelector('#popup[data-state="saved"]', { timeout: 60_000 });
  await pause(2200);

  const libraryOpened = context.waitForEvent("page", { predicate: (p) => p.url().includes("/libraryPage/") });
  await popup.click("#open");
  const library = await libraryOpened;
  const popupUntil = Date.now() / 1000;
  await popupCast.stop();
  await pageCast.stop();
  return { pageFrames: pageCast.frames, popupFrames: popupCast.frames, library, popupUntil };
}

async function recordLibrary(library) {
  await library.waitForLoadState("load");
  const cast = await startScreencast(library, framesDir, "library", device(PAGE));
  await pause(4000);
  return cast.stop();
}

await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });
const { context, worker, extensionId } = await launch();
try {
  console.log(`browser: seeded ${await seedLibrary(worker, join(scratch, "lib"), scratch)} papers`);
  const save = await recordSave(context, worker, extensionId);
  const libraryFrames = await recordLibrary(save.library);
  const t0 = save.pageFrames[0].timestamp;
  // The library tab takes over the page track the moment the popup's "Open in library" is clicked.
  const pageFrames = [...save.pageFrames.filter((f) => f.timestamp < save.popupUntil), { ...libraryFrames[0], timestamp: save.popupUntil }, ...libraryFrames.slice(1)]
    .map((f) => ({ ...f, timestamp: f.timestamp - t0 }));
  const popupFrames = save.popupFrames.map((f) => ({ ...f, timestamp: f.timestamp - save.popupFrames[0].timestamp }));
  const masters = { page: join(scratch, "page.mkv"), popup: join(scratch, "popup.mkv"), out: join(scratch, "capture.mkv") };
  await framesToVideo(pageFrames, masters.page, 0.5);
  await framesToVideo(popupFrames, masters.popup, 0.1);
  const from = save.popupFrames[0].timestamp - t0;
  await overlayPopup({ page: masters.page, popup: masters.popup, outPath: masters.out, from, until: save.popupUntil - t0 });
  await encodeClip(masters.out, join(repo, "website/media/browser/capture"), { posterAt: pageFrames.at(-1).timestamp });
  console.log(`browser: clip ${pageFrames.at(-1).timestamp.toFixed(1)} s, popup ${from.toFixed(1)}–${(save.popupUntil - t0).toFixed(1)} s`);
} finally {
  await context.close();
}
