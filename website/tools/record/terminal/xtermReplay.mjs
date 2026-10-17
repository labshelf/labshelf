// Replays recorded terminal bytes into xterm.js in headless Chromium and screenshots every change at device scale 2.
// Each screenshot lands at the time its bytes were recorded, so the clip keeps the real pacing without screencast jitter.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { openHeadlessPage } from "./headlessPage.mjs";

const XTERM = "https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0";
const FONTS = "https://fonts.googleapis.com/css2?family=Martian+Mono:wght@300;400;500;700&display=swap";
const FRAME_SECONDS = 1 / 30;

// The site's ink palette, website/css/tokens.css.
const THEME = {
  background: "#0d1118", foreground: "#d9dee7", cursor: "#d9dee7", cursorAccent: "#0d1118", selectionBackground: "#273041",
  black: "#1c2431", red: "#ee8a80", green: "#86c79f", yellow: "#e3b066", blue: "#86a9ec", magenta: "#7d9fe0", cyan: "#86a9ec", white: "#d9dee7",
  brightBlack: "#5b6476", brightRed: "#ee8a80", brightGreen: "#86c79f", brightYellow: "#e3b066", brightBlue: "#86a9ec",
  brightMagenta: "#7d9fe0", brightCyan: "#86a9ec", brightWhite: "#f3f4f6",
};

function pageHtml({ cols, rows, cursor }) {
  const options = { cols, rows, theme: THEME, fontFamily: '"Martian Mono", monospace', fontSize: 13, lineHeight: 1.25, cursorBlink: false, cursorStyle: "block", cursorInactiveStyle: cursor ? "block" : "none" };
  return `<!doctype html><meta charset="utf-8">
<link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="${XTERM}/css/xterm.css">
<style>html,body{margin:0;background:#0d1118}#box{display:inline-block;padding:24px 28px}</style>
<div id="box"><div id="term"></div></div>
<script src="${XTERM}/lib/xterm.js"></script>
<script>
window.ready = (async () => {
  await Promise.all(["300", "400", "500", "700"].map((w) => document.fonts.load(w + ' 13px "Martian Mono"')));
  const term = new Terminal(${JSON.stringify(options)});
  term.open(document.getElementById("term"));
  ${cursor ? "term.focus();" : ""}
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.put = (b64) => new Promise((r) => term.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), () => paint().then(r)));
  await paint();
  const box = document.getElementById("box").getBoundingClientRect();
  return { width: Math.ceil(box.width), height: Math.ceil(box.height) };
})();
</script>`;
}

/** Merges chunks that land within one video frame, so each screenshot covers a visible change. */
function groupByFrame(chunks) {
  const groups = [];
  for (const chunk of chunks) {
    const last = groups.at(-1);
    if (last && chunk.t - last.t < FRAME_SECONDS) last.data = Buffer.concat([last.data, chunk.data]);
    else groups.push({ t: chunk.t, data: chunk.data });
  }
  return groups;
}

// TRAP: Page.navigate returns before the document commits, so about:blank can still answer the first evaluations.
async function waitForTerminal(page) {
  for (let i = 0; i < 200; i++) {
    const loaded = await page.evaluate("location.protocol === 'file:' && typeof window.ready === 'object'");
    if (loaded) return page.evaluate("window.ready");
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("the xterm page never loaded; the CDN or the font host may be unreachable");
}

/**
 * Renders `chunks` frame by frame.
 * @param {{ t: number, data: Buffer }[]} chunks terminal output, times in seconds
 * @param {{ workDir: string, cols: number, rows: number, cursor?: boolean }} options
 * @returns {Promise<{ file: string, timestamp: number }[]>} PNG frames for framesToVideo
 */
export async function replayInXterm(chunks, { workDir, cols, rows, cursor = false }) {
  const framesDir = join(workDir, "frames");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const pagePath = join(workDir, "xterm.html");
  await writeFile(pagePath, pageHtml({ cols, rows, cursor }));
  const page = await openHeadlessPage(join(workDir, "chrome-profile"));
  try {
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 2, mobile: false });
    await page.send("Page.navigate", { url: pathToFileURL(pagePath).href });
    const { width, height } = await waitForTerminal(page);
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
    const frames = [];
    for (const [i, group] of groupByFrame(chunks).entries()) {
      await page.evaluate(`window.put(${JSON.stringify(group.data.toString("base64"))})`);
      const { data } = await page.send("Page.captureScreenshot", { format: "png" });
      const file = join(framesDir, `${String(i).padStart(5, "0")}.png`);
      await writeFile(file, Buffer.from(data, "base64"));
      frames.push({ file, timestamp: group.t });
    }
    return frames;
  } finally {
    await page.close();
  }
}
