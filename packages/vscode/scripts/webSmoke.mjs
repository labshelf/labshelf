/**
 * Loads the built web extension (out/web/extension.js) in a VS Code web host and fails unless it activates cleanly.
 * Serves VS Code for the web through @vscode/test-web and drives it with Playwright's headless Chromium; run `pnpm build` first.
 */
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "@vscode/test-web";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = 3917;
// TRAP: playwright is a dependency of @vscode/test-web, not of this package, so it resolves from there.
const { chromium } = createRequire(createRequire(import.meta.url).resolve("@vscode/test-web"))("playwright");

async function runFromPalette(page, title) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P");
  await page.keyboard.type(title);
  await page.waitForTimeout(1_000);
  await page.keyboard.press("Enter");
}

const server = await open({
  browserType: "none", extensionDevelopmentPath: pkgRoot, quality: "stable", port, hideServerLog: true,
  testRunnerDataDir: join(tmpdir(), "labshelf-vscode-test-web"),
});
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  const page = await browser.newPage();
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" && /labshelf/i.test(text)) { failures.push(text); }
  });
  await page.goto(`http://localhost:${port}`);
  await page.locator(".monaco-workbench").waitFor({ timeout: 120_000 });
  await page.waitForTimeout(5_000);
  // The LabShelf output channel and its first line come from the web composition root, so they prove the web entry activated.
  await runFromPalette(page, "Output: Show Output Channels");
  await page.keyboard.type("LabShelf");
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.getByText("Web build: PDF reading").first().waitFor({ timeout: 30_000 });
  console.log("[web-smoke] the web entry activated and logged to the LabShelf output channel");
  // Activation goes on without a library and registers every command; running one proves the registrations happened.
  await runFromPalette(page, "LabShelf: Research: Refresh Projects");
  await page.waitForTimeout(3_000);
  if (await page.getByText(/command '.*' not found/i).count() > 0) { failures.push("a LabShelf command was not found after activation"); }
  if (await page.getByText(/Activating extension .* failed/i).count() > 0) { failures.push("VS Code reported that activating LabShelf failed"); }
} catch (error) {
  failures.push(String(error));
} finally {
  await browser.close();
  await server.dispose();
}
if (failures.length > 0) {
  console.error(`[web-smoke] failed:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("[web-smoke] the web extension loaded and activated with no LabShelf errors");
