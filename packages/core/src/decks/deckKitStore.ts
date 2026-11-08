/** Lists and saves the deck Kits of a library: one JSON file per kit and its logo in the kits folder under the library root. */
// CONTRACT: documents/contracts/decks.md#kits
import type { PathOps } from "../path/index.js";
import type { LibraryFileSystem } from "../ports/index.js";
import { validateDeckStyle } from "./deckStyleTokens.js";
import {
  DECK_KIT_FOLDER, DECK_KIT_IMAGE_TOO_LARGE, DECK_KIT_MAX_IMAGE_BYTES, DECK_KIT_NAME_MAX, deckKitImageExtension, deckKitSlug, normaliseDeckKitName, parseDeckKit, serializeDeckKit,
} from "./deckKit.js";
import type { DeckKit, DeckKitImage } from "./deckKit.js";

export interface DeckKitStoreDeps { fs: Pick<LibraryFileSystem, "listDir" | "readText" | "writeText" | "writeFile" | "ensureDir" | "exists">; paths: PathOps; root: string }

async function readKit(deps: DeckKitStoreDeps, file: string): Promise<DeckKit | null> {
  try {
    return parseDeckKit(await deps.fs.readText(file));
  } catch {
    return null;
  }
}

/** The valid kits of the library sorted by name; a missing folder gives [], unreadable or invalid files are skipped. */
export async function listDeckKits(deps: DeckKitStoreDeps): Promise<DeckKit[]> {
  const folder = deps.paths.join(deps.root, DECK_KIT_FOLDER);
  if (!(await deps.fs.exists(folder))) return [];
  const names = (await deps.fs.listDir(folder)).filter((entry) => entry.toLowerCase().endsWith(".json"));
  const kits = await Promise.all(names.map((entry) => readKit(deps, deps.paths.join(folder, entry))));
  return kits.filter((kit): kit is DeckKit => kit !== null).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Writes the kit to kits/<slug>.json (over a kit of the same name) and a new logo to kits/<slug>.<ext>.
 * @returns the stored kit, as parseDeckKit reads it back
 * @throws Error on an empty or too long name, an invalid style, an unsupported or too large logo; nothing is written then
 */
export async function saveDeckKit(deps: DeckKitStoreDeps, kit: DeckKit, logo?: DeckKitImage): Promise<DeckKit> {
  const name = normaliseDeckKitName(kit.name);
  if (name === null) throw new Error(`A Kit needs a name of 1 to ${DECK_KIT_NAME_MAX} characters.`);
  const problems = validateDeckStyle(kit.style);
  if (problems.length > 0) throw new Error(`The Kit's style is invalid: ${problems.join("; ")}`);
  let ext: string | null = null;
  if (logo) {
    ext = deckKitImageExtension(logo.name);
    if (ext === null) throw new Error("Unsupported image type.");
    if (logo.bytes.byteLength > DECK_KIT_MAX_IMAGE_BYTES) throw new Error(DECK_KIT_IMAGE_TOO_LARGE);
  }
  const folder = deps.paths.join(deps.root, DECK_KIT_FOLDER);
  const slug = deckKitSlug(name);
  await deps.fs.ensureDir(folder);
  const draft: DeckKit = { ...kit, name };
  if (logo && ext !== null) {
    await deps.fs.writeFile(deps.paths.join(folder, `${slug}.${ext}`), logo.bytes);
    draft.logo = `${DECK_KIT_FOLDER}/${slug}.${ext}`;
  }
  const text = serializeDeckKit(draft);
  // The parse rule drops a logo or footer it would not read back, so the file and the returned kit agree.
  const stored = parseDeckKit(text);
  if (stored === null) throw new Error("The Kit could not be stored.");
  await deps.fs.writeText(deps.paths.join(folder, `${slug}.json`), serializeDeckKit(stored));
  return stored;
}
