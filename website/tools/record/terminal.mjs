// Records the site's terminal clips: the real TUI and CLI run in a pty on a copy of the demo library, replayed into xterm.js.
// Usage: node packages/terminal/build/build.mjs && node website/tools/record/terminal.mjs <scratch dir>  (needs the network)
import { execFileSync } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeClip, framesToVideo } from "./encode.mjs";
import { capturePty } from "./terminal/ptyCapture.mjs";
import { replayInXterm } from "./terminal/xtermReplay.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const media = join(repo, "website/media/terminal");
const bundle = join(repo, "packages/terminal/dist/labshelf.mjs");
// A CC BY 4.0 arXiv paper that the demo library does not hold: Tree of Thoughts (Yao et al., 2023).
const ARXIV_TO_ADD = "2305.10601";
// The scratch HOME stands in for the viewer's home folder in printed paths, so no real user name reaches a frame.
const SHOWN_HOME = "/Users/ada";

const work = process.argv[2] && resolve(process.argv[2]);
if (!work) {
  console.error("Usage: node website/tools/record/terminal.mjs <scratch dir>");
  process.exit(2);
}
const home = join(work, "home");
const library = join(home, "LabShelf");
const thesis = join(home, "thesis");

const env = {
  HOME: home, XDG_CONFIG_HOME: join(work, "xdg/config"), XDG_CACHE_HOME: join(work, "xdg/cache"), LABSHELF_TOKEN_STORE: "file",
  // Only node's folder: without pbcopy and open on PATH, `yc` cannot touch the real clipboard and nothing opens a PDF.
  PATH: dirname(process.execPath), TERM: "xterm-256color", COLORTERM: "truecolor", LANG: "en_US.UTF-8",
};

const SIZE = { tui: { cols: 120, rows: 24 }, cli: { cols: 100, rows: 12 } };
const PROMPT = Buffer.from("\x1b[38;2;134;169;236m~/thesis\x1b[0m \x1b[38;2;91;100;118m$\x1b[0m ");

/** Echoes a typed command at a steady, slightly uneven pace, as a shell would; returns the chunks and the end time. */
function typed(text, at) {
  const chunks = [{ t: at, data: PROMPT }];
  let t = at + 0.5;
  for (const [i, char] of [...text].entries()) {
    t += 0.045 + ((i * 7) % 5) * 0.008;
    chunks.push({ t, data: Buffer.from(char) });
  }
  t += 0.35;
  chunks.push({ t, data: Buffer.from("\r\n") });
  return { chunks, end: t };
}

function labshelf(args, size, keys, timeout) {
  return capturePty({ argv: [process.execPath, bundle, "-L", library, ...args], cwd: thesis, env, ...size, keys, timeout });
}

function shift(chunks, by) {
  return chunks.map(({ t, data }) => ({ t: t + by, data }));
}

function scrub(chunks) {
  const clean = chunks.map(({ t, data }) => ({ t, data: Buffer.from(data.toString("latin1").replaceAll(home, SHOWN_HOME), "latin1") }));
  const leak = clean.find(({ data }) => data.includes(work) || data.includes(process.env.HOME ?? "\0"));
  if (leak) throw new Error(`a frame would show a local path: ${JSON.stringify(leak.data.toString())}`);
  return clean;
}

/** Steps through folders, filters by status, cycles the preview tabs and copies a \cite{}. */
async function recordTui() {
  const shell = typed("labshelf", 0);
  const keys = [];
  let at = 1.0;
  const press = (data, gap) => keys.push({ at: (at += gap), data });
  // INVARIANT: the TUI starts with the paper list focused; `h` moves to the folders before stepping through them.
  press("h", 0.3);
  for (const key of "jjjkkk") press(key, 0.4);
  press("l", 0.5);
  press("f", 0.5);
  for (const char of "status:reading") press(char, 0.06);
  press("\r", 0.35);
  press("j", 0.7);
  for (let i = 0; i < 3; i++) press("\t", 0.8);
  press("y", 0.8);
  press("c", 0.15);
  const endAt = at + 1.5;
  keys.push({ at: endAt + 0.2, data: "q" });
  const app = await labshelf([], SIZE.tui, keys, endAt + 5);
  const chunks = [...shell.chunks, ...shift(app.filter(({ t }) => t <= endAt), shell.end)];
  return { chunks, duration: shell.end + endAt, posterAt: shell.end + 7.7 };
}

/** Adds a paper by arXiv id, searches by tag and writes a .bib, each a real command in turn. */
async function recordCli() {
  const commands = [["add", ARXIV_TO_ADD, "--to", "Language models/Reasoning"], ["search", "tag:reasoning"], ["bib", "-o", "refs.bib"]];
  const chunks = [];
  let t = 0;
  for (const args of commands) {
    const line = typed(`labshelf ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`, t);
    chunks.push(...line.chunks);
    const output = await labshelf(args, SIZE.cli, [], 120);
    // A network add can take seconds; the clip keeps at most 1.2 s of waiting so the loop stays short.
    const wait = Math.min(output[0]?.t ?? 0, 1.2) - (output[0]?.t ?? 0);
    chunks.push(...shift(output, line.end + wait));
    t = chunks.at(-1).t + 0.6;
  }
  chunks.push({ t, data: PROMPT });
  return { chunks, duration: t + 1.5, posterAt: t + 0.5 };
}

async function render(name, { chunks, duration, posterAt }, cursor) {
  const dir = join(work, name);
  await mkdir(dir, { recursive: true });
  const frames = await replayInXterm(scrub(chunks), { workDir: dir, ...SIZE[name], cursor });
  const master = join(dir, `${name}.mkv`);
  await framesToVideo(frames, master, Math.max(duration - frames.at(-1).timestamp, 0.5));
  await encodeClip(master, join(media, name), { posterAt });
  console.log(`${name}: ${frames.length} frames, ${duration.toFixed(1)} s`);
}

await rm(home, { recursive: true, force: true });
await rm(join(work, "xdg"), { recursive: true, force: true });
await mkdir(thesis, { recursive: true });
execFileSync(process.execPath, [join(repo, "website/tools/fetchDemoLibrary.mjs"), library], { stdio: "inherit" });
await render("tui", await recordTui(), false);
await render("cli", await recordCli(), true);
