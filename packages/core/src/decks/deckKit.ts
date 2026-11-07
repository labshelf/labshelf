/** The Kit of a deck: a named Style with an optional logo and footer, its JSON file form with a validating parser, and the port hosts give the Style panel. */
// CONTRACT: documents/contracts/decks.md#kits
import { parseJsonObject } from "../json/index.js";
import { DECK_STYLE_TOKENS, normaliseDeckStyle, validateDeckStyle } from "./deckStyleTokens.js";
import type { DeckStyle } from "./deckStyleTokens.js";

export interface DeckKit { name: string; style: DeckStyle; logo?: string; footer?: string }

/** An image picked by the user: its file name (for the extension) and its bytes. */
export interface DeckKitImage { name: string; bytes: Uint8Array }

/** What a host gives the Style panel for Kits: the library's kits, saving one (with a new logo), and picking an image. */
export interface DeckKitsPort { list(): Promise<DeckKit[]>; save(kit: DeckKit, logo?: DeckKitImage): Promise<DeckKit>; pickImage(): Promise<DeckKitImage | null> }

export const DECK_KIT_VERSION = 1;
/** The folder of the kits, under the library root. */
export const DECK_KIT_FOLDER = "kits";
/** Hosts refuse a picked image above it with DECK_KIT_IMAGE_TOO_LARGE. */
export const DECK_KIT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DECK_KIT_IMAGE_TOO_LARGE = "The image is larger than 5 MB.";
export const DECK_KIT_NAME_MAX = 80;
const FOOTER_MAX = 200;
const SLUG_MAX = 60;
const IMAGE_EXTENSIONS: readonly string[] = ["png", "jpg", "jpeg", "svg", "webp", "gif"];

/** The file name stem of a kit: lower case ASCII letters and digits joined by single dashes, at most 60 characters, "kit" when nothing is left. */
export function deckKitSlug(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const cut = base.slice(0, SLUG_MAX).replace(/-+$/, "");
  return cut === "" ? "kit" : cut;
}

/** The lower case extension of an image file name when it is one a kit may hold; null otherwise. */
export function deckKitImageExtension(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext) ? ext : null;
}

/** Whether a logo path is `kits/<file>` with a plain file name and an image extension. */
function isDeckKitLogo(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(`${DECK_KIT_FOLDER}/`)) return false;
  const file = value.slice(DECK_KIT_FOLDER.length + 1);
  if (file === "" || file.includes("/") || file.includes("\\") || file.includes("..")) return false;
  return deckKitImageExtension(file) !== null;
}

/** The name trimmed, or null when it is not a string, empty or over 80 characters. */
export function normaliseDeckKitName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name !== "" && name.length <= DECK_KIT_NAME_MAX ? name : null;
}

function readStyle(value: unknown): DeckStyle | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (DECK_STYLE_TOKENS.some((token) => !(token in record))) return null;
  const style = Object.fromEntries(DECK_STYLE_TOKENS.map((token) => [token, record[token]])) as unknown as DeckStyle;
  if (validateDeckStyle(style).length > 0) return null;
  return orderedStyle(normaliseDeckStyle(style));
}

function orderedStyle(style: DeckStyle): DeckStyle {
  return Object.fromEntries(DECK_STYLE_TOKENS.map((token) => [token, style[token]])) as unknown as DeckStyle;
}

function readFooter(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const footer = value.trim();
  return footer !== "" && footer.length <= FOOTER_MAX ? footer : undefined;
}

/** @returns null when the text is not a version 1 kit with a valid name and a full valid style; a bad logo or footer is dropped and the kit kept */
export function parseDeckKit(text: string): DeckKit | null {
  const record = parseJsonObject(text);
  if (!record || record["version"] !== DECK_KIT_VERSION) return null;
  const name = normaliseDeckKitName(record["name"]);
  if (name === null) return null;
  const style = readStyle(record["style"]);
  if (style === null) return null;
  const kit: DeckKit = { name, style };
  if (isDeckKitLogo(record["logo"])) kit.logo = record["logo"];
  const footer = readFooter(record["footer"]);
  if (footer !== undefined) kit.footer = footer;
  return kit;
}

/** The kit as its JSON file: version, name, style (token order, normalised), then logo and footer when present; 2-space indent and a final newline. */
export function serializeDeckKit(kit: DeckKit): string {
  const out: Record<string, unknown> = { version: DECK_KIT_VERSION, name: kit.name, style: orderedStyle(normaliseDeckStyle(kit.style)) };
  if (kit.logo !== undefined) out["logo"] = kit.logo;
  if (kit.footer !== undefined) out["footer"] = kit.footer;
  return `${JSON.stringify(out, null, 2)}\n`;
}
