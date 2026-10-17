// Records the VS Code clips from an isolated VS Code window on the demo library, as website/media/vscode/<name>.
// Usage: node website/tools/record/vscode.mjs <@vscode/test-electron Code binary> <scratch dir> [clip names]
// The scratch dir holds the demo library at lib/ (node website/tools/fetchDemoLibrary.mjs <scratch>/lib); build the
// extension first with `pnpm --filter @labshelf/vscode build`.
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeClip, framesToVideo } from "./encode.mjs";
import { startScreencast } from "./screencast.mjs";
import { launchHost, WINDOW } from "./vscode/host.mjs";
import { addPaper, library } from "./vscode/libraryTakes.mjs";
import { installPointer } from "./vscode/pointer.mjs";
import { reader } from "./vscode/readerTake.mjs";
import { frameWorkbench, pause, SCALE } from "./vscode/workbench.mjs";
import { check, citeCompletion, preview } from "./vscode/writingTakes.mjs";

const SCENARIOS = { library, "add-paper": addPaper, reader, "cite-completion": citeCompletion, preview, check };
const media = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "media", "vscode");

const [codeBin, scratch, ...names] = process.argv.slice(2);
if (!codeBin || !scratch) {
  console.error("Usage: node vscode.mjs <Code binary> <scratch dir> [clip names]");
  process.exit(2);
}
const unknown = names.filter((name) => !SCENARIOS[name]);
if (unknown.length > 0) throw new Error(`unknown clips: ${unknown.join(", ")}; known: ${Object.keys(SCENARIOS).join(", ")}`);

async function record(host, name) {
  const scenario = SCENARIOS[name];
  const { page } = host;
  const context = await scenario.setup(page, host);
  const pointer = await installPointer(page);
  const framesDir = join(scratch, "frames", name);
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const cast = await startScreencast(page, framesDir, name, { width: WINDOW.width * SCALE, height: WINDOW.height * SCALE });
  let frames;
  try {
    await scenario.take(page, pointer, context);
  } finally {
    frames = await cast.stop();
    await pointer.remove();
    await scenario.after?.(page, host);
  }
  const master = join(scratch, "masters", `${name}.mkv`);
  await framesToVideo(frames, master);
  await encodeClip(master, join(media, name), { posterAt: frames.at(-1).timestamp - frames[0].timestamp - 0.5 });
  console.log(`recorded ${name}: ${frames.length} frames`);
}

const host = await launchHost({ codeBin, scratch, workspace: "projects/llm-reasoning-notes" });
try {
  await frameWorkbench(host.page);
  // The extension activates and indexes the library in the first seconds.
  await pause(4000);
  for (const name of names.length > 0 ? names : Object.keys(SCENARIOS)) {
    await record(host, name).catch(async (error) => {
      await host.page.screenshot({ path: join(scratch, `failed-${name}.png`) });
      throw error;
    });
  }
} finally {
  await host.stop();
}
