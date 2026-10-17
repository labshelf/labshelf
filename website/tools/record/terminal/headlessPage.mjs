// Opens one page in Playwright's cached headless Chromium shell and drives it over the DevTools protocol.
// PLATFORM: /Applications/Google Chrome.app dies at startup in headless mode on macOS; the Playwright shell works.
import { spawn } from "node:child_process";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const SHELL = join(homedir(), "Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell");

async function waitForPort(userDataDir) {
  for (let i = 0; i < 100; i++) {
    const text = await readFile(join(userDataDir, "DevToolsActivePort"), "utf8").catch(() => "");
    const [port, path] = text.split("\n");
    if (path) return `ws://127.0.0.1:${port}${path}`;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`headless shell wrote no DevToolsActivePort in ${userDataDir}`);
}

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message}`));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, method });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve({ send, close: () => socket.close() }));
    socket.addEventListener("error", () => reject(new Error(`cannot connect to ${url}`)));
  });
}

/**
 * Launches the shell with a throwaway profile and attaches to a blank page.
 * @param {string} userDataDir scratch folder for the profile, wiped first
 * @returns {Promise<{ send: (method: string, params?: object) => Promise<any>, evaluate: (expression: string) => Promise<any>, close: () => Promise<void> }>}
 */
export async function openHeadlessPage(userDataDir) {
  await rm(userDataDir, { recursive: true, force: true });
  await mkdir(userDataDir, { recursive: true });
  const chrome = spawn(SHELL, ["--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  const browser = await connect(await waitForPort(userDataDir));
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => browser.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`page threw: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  };
  const close = async () => {
    browser.close();
    chrome.kill();
  };
  return { send, evaluate, close };
}
