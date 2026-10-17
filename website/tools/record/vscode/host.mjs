// Launches an isolated VS Code copy with the LabShelf extension on a demo library and connects to it over CDP.
// TRAP: never pass the installed /Applications app as `codeBin`; its exit closes the user's own windows.
import { spawn } from "node:child_process";
import { mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
// PLATFORM: the user-data-dir holds an IPC socket whose path must stay under about 103 characters.
const shortUserDataDir = join(repo, ".udd-rec");
const PORT = 9333;
// The largest 16:10 window that fits a 14-inch MacBook screen; encode.mjs scales the 2x frames to the site width.
export const WINDOW = { width: 1440, height: 900 };

const settings = {
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.startupEditor": "none",
  "workbench.tips.enabled": false,
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  // The native title bar is outside the page, so the screencast leaves out "[Extension Development Host]".
  "window.titleBarStyle": "native",
  "window.customTitleBarVisibility": "never",
  "editor.fontSize": 15,
  "editor.minimap.enabled": false,
  "editor.stickyScroll.enabled": false,
  "chat.disableAIFeatures": true,
  "extensions.ignoreRecommendations": true,
  "git.enabled": false,
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "labshelf.reader.citationStyle": "latex",
};

async function prepareProfile(scratch, library, folder) {
  const userDataDir = join(scratch, "udd");
  await mkdir(join(userDataDir, "User", "globalStorage"), { recursive: true });
  await writeFile(join(userDataDir, "User", "settings.json"), JSON.stringify(settings, null, 2));
  // PLATFORM: Electron's CDP has no Browser.setWindowBounds; a development host restores its size from this entry.
  const uiState = { mode: 1, x: 40, y: 40, ...WINDOW };
  const windowsState = { lastPluginDevelopmentHostWindow: { folder: pathToFileURL(folder).href, uiState }, openedWindows: [] };
  await writeFile(join(userDataDir, "User", "globalStorage", "storage.json"), JSON.stringify({ windowsState }));
  await mkdir(join(scratch, "xdg", "labshelf"), { recursive: true });
  // CONTRACT: documents/contracts/library-format.md#shared-configuration
  await writeFile(join(scratch, "xdg", "labshelf", "config.json"), JSON.stringify({ libraryRoot: library }, null, 2));
  await rm(shortUserDataDir, { force: true });
  await symlink(userDataDir, shortUserDataDir);
}

/** Starts the window and resolves once its workbench page answers over CDP. */
export async function launchHost({ codeBin, scratch, workspace }) {
  if (codeBin.startsWith("/Applications/")) throw new Error("Refusing to run the installed VS Code; pass a @vscode/test-electron copy.");
  const realScratch = await realpath(scratch);
  // INVARIANT: the library and workspace stay on real paths, or project lookup and synctex miss.
  const library = join(realScratch, "lib");
  const folder = join(library, workspace);
  await prepareProfile(realScratch, library, folder);
  const env = { ...process.env, XDG_CONFIG_HOME: join(realScratch, "xdg") };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(codeBin, [
    "--no-sandbox", `--user-data-dir=${shortUserDataDir}`, `--extensions-dir=${join(realScratch, "ext")}`,
    "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", "--disable-telemetry", "--disable-updates",
    `--remote-debugging-port=${PORT}`, `--extensionDevelopmentPath=${join(repo, "packages", "vscode")}`,
    folder,
  ], { env, stdio: "ignore" });
  console.log(`VS Code pid ${child.pid}`);
  const exited = new Promise((done) => child.once("exit", done));
  // The symlink goes only after exit; removed earlier, a closing window recreates the path as a real folder.
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    await rm(shortUserDataDir, { force: true });
  };
  try {
    const browser = await connect();
    const page = await workbenchPage(browser);
    return { pid: child.pid, browser, page, library, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function connect() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await sleep(500); }
  }
  throw new Error(`VS Code did not open CDP on port ${PORT} within 30 s`);
}

async function workbenchPage(browser) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const page = browser.contexts().flatMap((context) => context.pages()).find((p) => p.url().includes("workbench"));
    if (page) {
      await page.waitForSelector(".monaco-workbench", { timeout: 30_000 });
      return page;
    }
    await sleep(500);
  }
  throw new Error("VS Code opened no workbench page within 30 s");
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
