// Measures the browser library page on a 2,000-paper, 50-project fixture under 4x CPU throttling and prints the A9 budgets.
// Usage: PERF_EXT=<dist/chrome> PERF_CHROMIUM=<chrome binary> PERF_BRIDGE=<bridge binary> [PERF_HELPER=<helper binary>] [PERF_WORK=<scratch dir>] node packages/browser/scripts/perfCheck.mjs
// Everything runs under PERF_WORK (fixture library, HOME, profile); never point it at a real library or profile.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { chromium } from "playwright-core";

const PAPERS = 2000;
const FOLDERS = 20;
const PROJECTS = 50;
const THROTTLE = 4;
const TYPED = 200;
const BUDGET = { sidebarMs: 1500, editorMs: 1000, taskMs: 50 };

function need(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const ext = need("PERF_EXT");
const chromiumPath = need("PERF_CHROMIUM");
const bridge = need("PERF_BRIDGE");
const helper = process.env["PERF_HELPER"];
const work = process.env["PERF_WORK"] ?? mkdtempSync(join(tmpdir(), "labshelf-perf-"));

// The extension id is derived from the manifest's public key: SHA-256, first 16 bytes, hex digits mapped to a-p.
function extensionId() {
  const { key } = JSON.parse(readFileSync(join(ext, "manifest.json"), "utf8"));
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16))).join("");
}

function put(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function buildFixture(root) {
  rmSync(root, { recursive: true, force: true });
  const statuses = ["unread", "reading", "done"];
  for (let i = 0; i < PAPERS; i++) {
    const id = `author${i}paper${i}`;
    const folder = `Topic ${String(i % FOLDERS).padStart(2, "0")}${i % 7 === 0 ? "/Sub" : ""}`;
    put(join(root, "papers", folder, id, "metadata.yaml"), [
      `title: Fixture paper number ${i} on a measurable subject`,
      `citekey: ${id}`,
      `authors: [Alice Author${i}, Bob Writer${i % 97}]`,
      `year: ${1990 + (i % 35)}`,
      `status: ${statuses[i % 3]}`,
      `tags: [fixture, group${i % 13}]`,
      `summary: ${"A sentence of abstract text. ".repeat(6).trim()}`,
      "",
    ].join("\n"));
  }
  const body = Array.from({ length: 200 }, (_, n) => `Line ${n} of the project text, long enough to look like a paragraph of prose.\n`).join("");
  for (let i = 0; i < PROJECTS; i++) {
    const dir = join(root, "projects", `project${String(i).padStart(2, "0")}`);
    put(join(dir, "labshelf.yaml"), `id: project${String(i).padStart(2, "0")}\nformat: latex\nmain: main.tex\ntitle: Fixture project ${String(i).padStart(2, "0")}\n`);
    put(join(dir, "main.tex"), `\\documentclass{article}\n\\begin{document}\n${body}\\include{chapters/one}\n\\end{document}\n`);
    put(join(dir, "chapters", "one.tex"), `\\section{One}\n${body}`);
  }
}

function writeHostManifests(profile, id) {
  const hostManifest = (name, description, path) => put(join(profile, "NativeMessagingHosts", `${name}.json`),
    JSON.stringify({ name, description, path, type: "stdio", allowed_origins: [`chrome-extension://${id}/`] }, null, 2));
  hostManifest("app.labshelf.bridge", "LabShelf bridge to the library folder", bridge);
  if (helper) hostManifest("dev.labshelf.helper", "LabShelf Helper", helper);
}

// Records long tasks (>= 50 ms, the browser's own threshold) and the first time the sidebar lists the last project.
const PROBE = `
  window.__perf = { longTasks: [], sidebarAt: null };
  new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__perf.longTasks.push(e.duration); }).observe({ type: "longtask", buffered: true });
  const watch = new MutationObserver(() => {
    if (window.__perf.sidebarAt === null && document.querySelector(".sidebar")?.textContent.includes("Fixture project ${String(PROJECTS - 1).padStart(2, "0")}")) {
      requestAnimationFrame(() => requestAnimationFrame(() => { window.__perf.sidebarAt = performance.now(); }));
    }
  });
  document.addEventListener("DOMContentLoaded", () => watch.observe(document.documentElement, { childList: true, subtree: true, characterData: true }));
`;

const longest = (tasks) => (tasks.length === 0 ? 0 : Math.max(...tasks));
const takeTasks = (page) => page.evaluate(() => window.__perf.longTasks.splice(0));
const fmt = (ms) => `${Math.round(ms)} ms`;
const verdict = (ok) => (ok ? "PASS" : "FAIL");

async function main() {
  const id = extensionId();
  const library = join(work, "library");
  const home = join(work, "home");
  const profile = join(work, "profile");
  buildFixture(library);
  rmSync(profile, { recursive: true, force: true });
  put(join(home, ".config", "labshelf", "config.json"), JSON.stringify({ version: 1, libraryRoot: library }));
  writeHostManifests(profile, id);

  const launch = () => chromium.launchPersistentContext(profile, {
    executablePath: chromiumPath,
    headless: false,
    args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    env: { ...process.env, HOME: home },
    viewport: { width: 1400, height: 900 },
  });
  await fillPaperCache(await launch(), id);
  const context = await launch();
  try {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(PROBE);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });

    await page.goto(`chrome-extension://${id}/library-page/index.html`);
    await page.waitForFunction(() => window.__perf.sidebarAt !== null, undefined, { timeout: 60_000 });
    const sidebarMs = await page.evaluate(() => window.__perf.sidebarAt);
    await page.waitForTimeout(3000);
    const loadTask = longest(await takeTasks(page));
    const canary = await measureCanary(page);

    const scrollMs = await scrollPaperList(page);
    const scrollTask = longest(await takeTasks(page));

    const editorMs = await openSource(page);
    await takeTasks(page);
    await page.keyboard.type("q".repeat(TYPED), { delay: 0 });
    await page.waitForTimeout(1500);
    const typingTask = longest(await takeTasks(page));
    const typed = await page.evaluate(() => (document.querySelector(".cm-content")?.textContent.match(/q/g) ?? []).length);

    const rows = [
      ["page open -> sidebar painted", fmt(sidebarMs), `<= ${BUDGET.sidebarMs} ms`, verdict(sidebarMs <= BUDGET.sidebarMs)],
      ["source tab open -> editor accepts input", fmt(editorMs), `<= ${BUDGET.editorMs} ms`, verdict(editorMs <= BUDGET.editorMs)],
      [`longest task typing ${TYPED} chars`, fmt(typingTask), `<= ${BUDGET.taskMs} ms`, verdict(typingTask <= BUDGET.taskMs)],
      [`longest task scrolling ${PAPERS} rows (${fmt(scrollMs)} wall)`, fmt(scrollTask), `<= ${BUDGET.taskMs} ms`, verdict(scrollTask <= BUDGET.taskMs)],
    ];
    for (const r of rows) console.log(r.join("  |  "));
    console.log(`longest task during page load: ${fmt(loadTask)}; ${typed} of ${TYPED} typed characters in the editor; throttle canary (work sized to 80 ms) measured ${fmt(canary)}`);
    console.log(`(a task under 50 ms is not reported by the browser and shows as 0 ms; CPU throttling ${THROTTLE}x; workdir ${work})`);
    if (errors.length > 0) console.log(`page errors:\n${errors.join("\n")}`);
    process.exitCode = rows.some((r) => r[3] === "FAIL") ? 1 : 0;
  } finally {
    await context.close();
  }
}

// A fresh profile has no cached paper records: one visit rebuilds them from the folder, then the browser is closed so the measured visit starts cold on a filled cache.
async function fillPaperCache(context, id) {
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${id}/library-page/index.html`);
    for (let attempt = 0; attempt < 12; attempt++) {
      await page.waitForTimeout(5000);
      await page.reload();
      await page.waitForTimeout(2000);
      if (await page.evaluate(() => (document.querySelector(".paper-list")?.scrollHeight ?? 0) > 5000)) return;
    }
    throw new Error("the paper list stayed empty; the fixture library did not load");
  } finally {
    await context.close();
  }
}

// A fixed amount of work sized to take about 80 ms under the throttle must show up as a long task of about that length; a time-based loop would not be scaled by the throttle.
async function measureCanary(page) {
  await page.evaluate(() => new Promise((resolve) => setTimeout(() => {
    const spin = (n) => { let x = 0; for (let i = 0; i < n; i++) x += Math.sqrt(i); return x; };
    const t0 = performance.now();
    spin(2_000_000);
    spin(Math.round(2_000_000 * 80 / Math.max(performance.now() - t0, 1)));
    resolve(undefined);
  }, 0)));
  await page.waitForTimeout(200);
  return longest(await takeTasks(page));
}

// Scrolls the Library tab's paper list from top to bottom in viewport-sized steps and returns the wall time.
async function scrollPaperList(page) {
  const start = Date.now();
  await page.evaluate(async () => {
    const list = document.querySelector(".paper-list");
    if (!list) throw new Error("no scrollable paper list");
    for (let top = 0; top < list.scrollHeight; top += list.clientHeight / 2) {
      list.scrollTop = top;
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    }
  });
  return Date.now() - start;
}

// Clicks the first project in the sidebar and waits until a typed character lands in the editor.
async function openSource(page) {
  const start = Date.now();
  await page.locator(".sidebar .tree-row", { hasText: "Fixture project 00" }).first().click();
  const content = page.locator(".cm-content");
  await content.waitFor({ state: "visible", timeout: 30_000 });
  await content.click();
  await page.keyboard.type("!");
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("!"), undefined, { timeout: 30_000 });
  return Date.now() - start;
}

await main();
