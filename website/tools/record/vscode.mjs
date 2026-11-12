// Records the VS Code clips from an isolated VS Code window on the demo library, as website/media/<section>/<name>.
// Usage: node website/tools/record/vscode.mjs <@vscode/test-electron Code binary> <scratch dir> [clip names]
// The scratch dir holds the demo library at lib/ (node website/tools/fetchDemoLibrary.mjs <scratch>/lib); build the
// extension first with `pnpm --filter @labshelf/vscode build`.
import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeClip, framesToVideo } from "./encode.mjs";
import { startScreencast } from "./screencast.mjs";
import { launchHost, WINDOW } from "./vscode/host.mjs";
import { LIBRARY_TAKES } from "./vscode/libraryTakes.mjs";
import { NOTES_TAKES } from "./vscode/notesTakes.mjs";
import { installPointer } from "./vscode/pointer.mjs";
import { READING_TAKES } from "./vscode/readerTake.mjs";
import { SPACES_TAKES } from "./vscode/spacesTakes.mjs";
import { TALKS_TAKES } from "./vscode/talksTakes.mjs";
import { frameWorkbench, pause, SCALE } from "./vscode/workbench.mjs";
import { WRITING_TAKES } from "./vscode/writingTakes.mjs";

// Each section's takes, keyed "<section>/<clip>"; the key is also the clip's path under website/media/.
const SECTIONS = { library: LIBRARY_TAKES, reading: READING_TAKES, notes: NOTES_TAKES, spaces: SPACES_TAKES, writing: WRITING_TAKES, talks: TALKS_TAKES };
const SCENARIOS = Object.fromEntries(Object.entries(SECTIONS).flatMap(([section, takes]) => Object.entries(takes).map(([clip, take]) => [`${section}/${clip}`, take])));
const media = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "media");

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
  const framesDir = join(scratch, "frames", name.replace("/", "-"));
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const cast = await startScreencast(page, framesDir, name.replace("/", "-"), { width: WINDOW.width * SCALE, height: WINDOW.height * SCALE });
  let frames;
  try {
    await scenario.take(page, pointer, context);
  } finally {
    frames = await cast.stop();
    await pointer.remove();
    await scenario.after?.(page, host);
  }
  const master = join(scratch, "masters", `${name.replace("/", "-")}.mkv`);
  await framesToVideo(frames, master);
  // A take may name its poster moment (seconds from the start); the default is the last half second.
  const posterAt = scenario.posterAt ?? frames.at(-1).timestamp - frames[0].timestamp - 0.5;
  await encodeClip(master, join(media, name), { posterAt });
  console.log(`recorded ${name}: ${frames.length} frames`);
}

const host = await launchHost({ codeBin, scratch, workspace: process.env.REC_WORKSPACE ?? "projects/llm-reasoning-notes" });
try {
  await frameWorkbench(host.page);
  // The extension activates and indexes the library in the first seconds.
  await pause(4000);
  for (const name of names.length > 0 ? names : Object.keys(SCENARIOS)) {
    await record(host, name).catch(async (error) => {
      await host.page.screenshot({ path: join(scratch, `failed-${name.replace("/", "-")}.png`) });
      throw error;
    });
  }
} finally {
  await host.stop();
}
