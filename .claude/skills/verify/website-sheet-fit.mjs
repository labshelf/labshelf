#!/usr/bin/env node
// Reports every website sheet whose content overflows, at 1440, 768 and 390 px wide in each page theme; exits 1 when any does.
// Usage: node .claude/skills/verify/website-sheet-fit.mjs [--inject-overflow]
// --inject-overflow grows sheet 2 in the browser only, to prove the check can fail. Needs Playwright's headless shell in ~/Library/Caches/ms-playwright (run outside the sandbox).
// Dependency-free: Node's global WebSocket drives the DevTools protocol. "auto" is not listed because it resolves to light or dark.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";

const WIDTHS = [1440, 768, 390];
const THEMES = ["light", "dark", "sepia", "high-contrast"];
const THEME_KEY = "labshelf.site.theme";
const TOLERANCE = 1;
const root = resolve(import.meta.dirname, "../../../website");
const inject = process.argv.includes("--inject-overflow");
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm" };

function serve() {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    let file = join(root, path);
    try { if (statSync(file).isDirectory()) file = join(file, "index.html"); } catch { /* 404 below */ }
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const body = readFileSync(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

function findShell() {
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const dir = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  if (!dir) throw new Error(`no chromium_headless_shell-* in ${cache}`);
  return join(cache, dir, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
}

function launch(profile) {
  const child = spawn(findShell(), ["--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  return new Promise((ok, fail) => {
    let log = "";
    child.stderr.on("data", (chunk) => {
      log += chunk;
      const match = log.match(/ws:\/\/\S+/);
      if (match) ok({ child, url: match[0] });
    });
    child.on("exit", () => fail(new Error(`browser exited before listening:\n${log}`)));
  });
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error("DevTools connection failed")); });
  let id = 0;
  const pending = new Map();
  const waiting = new Map();
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const { ok, fail } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? fail(new Error(`${msg.error.message}`)) : ok(msg.result);
    } else waiting.get(msg.method)?.(msg.params);
  };
  const send = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    pending.set(++id, { ok, fail });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
  const once = (method) => new Promise((ok) => waiting.set(method, ok));
  return { send, once, close: () => ws.close() };
}

// Runs in the page: one record per sheet in #viewer, with the box that content must stay inside.
const MEASURE = `(async () => {
  await document.fonts.ready;
  await new Promise((r) => setTimeout(r, 400));
  const sheets = [...document.querySelectorAll("#viewer .page")];
  ${inject ? `sheets[1].insertAdjacentHTML("beforeend", '<div style="height:900px;width:2000px">injected</div>');` : ""}
  return {
    theme: document.documentElement.dataset.theme,
    sheets: sheets.map((p, i) => {
      const [a, b] = getComputedStyle(p).aspectRatio.split("/").map(Number);
      // A sheet with a fixed ratio grows to fit its content instead of scrolling, so growth past the ratio is the overflow.
      const expected = b ? p.clientWidth * b / a : p.clientHeight;
      return {
        n: i + 1,
        name: p.id || p.querySelector("h1, h2")?.textContent.trim().replace(/\\s+/g, " ").slice(0, 40) || "untitled",
        dx: Math.max(0, p.scrollWidth - p.clientWidth),
        dy: Math.max(0, p.scrollHeight - p.clientHeight, p.clientHeight - expected),
      };
    }),
  };
})()`;

async function main() {
  const server = await serve();
  const profile = mkdtempSync(join(tmpdir(), "sheet-fit-"));
  const { child, url } = await launch(profile);
  const cdp = await connect(url);
  let checked = 0;
  let overflowing = 0;
  try {
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    await page("Page.enable");
    const site = `http://127.0.0.1:${server.address().port}/`;
    for (const theme of THEMES) {
      const { identifier } = await page("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem(${JSON.stringify(THEME_KEY)}, ${JSON.stringify(JSON.stringify(theme))})` });
      for (const width of WIDTHS) {
        await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
        const loaded = cdp.once("Page.loadEventFired");
        await page("Page.navigate", { url: site });
        await loaded;
        const { result, exceptionDetails } = await page("Runtime.evaluate", { expression: MEASURE, awaitPromise: true, returnByValue: true });
        if (exceptionDetails) throw new Error(`measure failed at ${width} ${theme}: ${exceptionDetails.text}`);
        if (result.value.theme !== theme) throw new Error(`asked for theme ${theme}, page applied ${result.value.theme}`);
        for (const s of result.value.sheets) {
          checked++;
          if (s.dx <= TOLERANCE && s.dy <= TOLERANCE) continue;
          overflowing++;
          console.log(`OVERFLOW ${width} ${theme} sheet ${s.n} (${s.name}): +${Math.round(s.dx)}x${Math.round(s.dy)}px`);
        }
      }
      await page("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  } finally {
    cdp.close();
    const exited = new Promise((ok) => child.once("exit", ok));
    child.kill();
    await exited;
    server.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log(`sheets: ${checked}, overflowing: ${overflowing}`);
  process.exitCode = overflowing ? 1 : 0;
}

main().catch((err) => { console.error(`sheet-fit failed: ${err.message}`); process.exit(2); });
