// Screenshots the library list fixture in light, dark and narrow layouts and records console errors.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import * as themes from './vscodeThemes.mjs';

const outDir = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.verify/library');
const out = (name) => path.join(outDir, name);
mkdirSync(outDir, { recursive: true });
// PLATFORM: playwright-core looks only for the headless shell of its pinned revision; any installed revision renders these pages the same.
function headlessShell() {
  if (process.env.LABSHELF_HEADLESS_SHELL) return process.env.LABSHELF_HEADLESS_SHELL;
  if (existsSync(chromium.executablePath())) return undefined;
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright');
  const newest = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop() : undefined;
  if (!newest) throw new Error(`No headless shell in ${cache}: run \`pnpm exec playwright-core install chromium-headless-shell\` or set LABSHELF_HEADLESS_SHELL.`);
  const exe = path.join(cache, newest, 'chrome-headless-shell-mac-arm64/chrome-headless-shell');
  console.warn(`Pinned headless shell missing; using ${newest}.`);
  return exe;
}
const browser = await chromium.launch({ executablePath: headlessShell() });
const logs = [];

async function open(theme, { w = 1280, h = 800, query = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  const tag = `[${theme} ${w}${query}]`;
  p.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`${tag} ${m.type()}: ${m.text()}`); });
  p.on('pageerror', (e) => logs.push(`${tag} pageerror: ${e.message}`));
  await p.addInitScript(({ css, theme }) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
      const kind = theme === 'light' ? 'vscode-light' : 'vscode-dark';
      document.body.classList.add(kind);
      document.body.dataset.vscodeThemeKind = kind;
    });
  }, { css: themes[theme], theme });
  await p.goto('file://' + out('index.html') + query);
  await p.waitForFunction(() => window.__ready);
  return p;
}

const show = async (p, folder, selected) => {
  await p.evaluate(([f, s]) => window.__show(f, s), [folder, selected]);
  await p.waitForTimeout(400);
};

for (const theme of ['light', 'dark']) {
  const p = await open(theme);
  await show(p, 'papers', 'attention');
  await p.screenshot({ path: out(`all-${theme}.png`) });
  await show(p, 'papers/Deep learning', 'resnet');
  await p.screenshot({ path: out(`folder-${theme}.png`) });
  await show(p, 'papers', 'attention');
  const row = p.locator('.file-row[data-name="data.csv"]');
  if (await row.count()) {
    await row.hover();
    await p.waitForTimeout(200);
    await p.screenshot({ path: out(`hover-${theme}.png`) });
  } else logs.push(`info: [${theme}] tray row data.csv not found`);
  await p.context().close();
}
for (const w of [700, 450, 330]) {
  const p = await open('light', { w, query: '?detail=off&sidebar=off' });
  await show(p, 'papers', 'attention');
  await p.screenshot({ path: out(`narrow-${w}.png`) });
  await p.context().close();
}
writeFileSync(out('console.txt'), logs.join('\n') + '\n');
await browser.close();
console.log(`${outDir}: all/folder/hover × light/dark, narrow-700/450/330; console.txt has ${logs.length} line(s)`);
