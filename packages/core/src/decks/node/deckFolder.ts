// Finds a deck folder by real path inside the project, lists its files and writes files into it without leaving it.
import { promises as fs, type Stats } from "node:fs";
import * as path from "node:path";

import { isInside } from "../../path/index.js";
import { deckRootOf, type DeckPath } from "../index.js";
import { ToolRefusal } from "./deckToolArgs.js";

const OUTSIDE = "The deck folder resolves outside the project.";

/** The real paths of a deck folder and of its root (`talks` or `posters`) once the project folder is resolved. */
export interface DeckLocation { real: string; realRoot: string; relative: string }

export interface DeckFile { path: string; data: string | Buffer }

const lstatOf = (file: string): Promise<Stats | undefined> => fs.lstat(file).catch(() => undefined);

/** An existing path must resolve to exactly the expected real path; a symlink leading elsewhere is refused. */
async function requireSame(file: string, expected: string): Promise<void> {
  if ((await lstatOf(file)) === undefined) return;
  if ((await fs.realpath(file).catch(() => undefined)) !== expected) throw new ToolRefusal(OUTSIDE);
}

/** The deck folder under the real path of the project; refuses a root or deck folder that is a symlink leading elsewhere. */
export async function locateDeck(projectFolder: string, deck: DeckPath): Promise<DeckLocation> {
  const realProject = await fs.realpath(projectFolder);
  const root = deckRootOf(deck.kind);
  const realRoot = path.join(realProject, root);
  const real = path.join(realRoot, deck.name);
  await requireSame(path.join(projectFolder, root), realRoot);
  await requireSame(path.join(projectFolder, root, deck.name), real);
  return { real, realRoot, relative: deck.folder };
}

/** Creates the deck folder and checks again that it landed where located. */
export async function ensureDeckFolder(location: DeckLocation): Promise<void> {
  await fs.mkdir(location.real, { recursive: true });
  if ((await fs.realpath(location.real).catch(() => undefined)) !== location.real) throw new ToolRefusal(OUTSIDE);
  if ((await fs.realpath(location.realRoot).catch(() => undefined)) !== location.realRoot) throw new ToolRefusal(OUTSIDE);
}

/** The text of a regular file; undefined for a missing file, a symlink or a folder. */
export async function readRegularText(file: string): Promise<string | undefined> {
  const stat = await lstatOf(file);
  return stat?.isFile() === true ? fs.readFile(file, "utf8") : undefined;
}

/** Deck-folder-relative paths of the regular files below the folder, sorted; symlinks are not followed or listed. */
export async function listDeckFiles(folder: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(folder, prefix), { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await listDeckFiles(folder, relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

async function checkTarget(deckReal: string, file: DeckFile): Promise<void> {
  const segments = file.path.split("/");
  let current = deckReal;
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    if ((await lstatOf(current)) === undefined) break;
    const real = await fs.realpath(current).catch(() => undefined);
    if (real === undefined || !isInside(path, deckReal, real, { allowEqual: true })) throw new ToolRefusal(`${file.path} resolves outside the deck folder.`);
    if (!(await fs.stat(real)).isDirectory()) throw new ToolRefusal(`${file.path} is blocked by the file ${segment}.`);
  }
  const existing = await lstatOf(path.join(deckReal, ...segments));
  if (existing?.isSymbolicLink() === true) throw new ToolRefusal(`${file.path} is a symbolic link; refusing to write through it.`);
  if (existing?.isDirectory() === true) throw new ToolRefusal(`${file.path} is a folder.`);
}

/** Checks every target first and writes only when all are fine: parents inside the deck folder, no symlink target. */
export async function writeDeckFiles(deckReal: string, files: readonly DeckFile[]): Promise<void> {
  for (const file of files) await checkTarget(deckReal, file);
  for (const file of files) {
    const target = path.join(deckReal, ...file.path.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const parent = await fs.realpath(path.dirname(target));
    if (!isInside(path, deckReal, parent, { allowEqual: true })) throw new ToolRefusal(`${file.path} resolves outside the deck folder.`);
    await fs.writeFile(target, file.data);
  }
}

/** True when the file is a regular file holding exactly these contents. */
export async function sameContent(file: string, data: string | Buffer): Promise<boolean> {
  if ((await lstatOf(file))?.isFile() !== true) return false;
  return Buffer.compare(await fs.readFile(file), typeof data === "string" ? Buffer.from(data, "utf8") : data) === 0;
}
