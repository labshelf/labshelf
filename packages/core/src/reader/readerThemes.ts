// Keeps the user's custom reader themes in the library's reader-themes.json, shared by every paper and app.
// CONTRACT: documents/contracts/library-format.md#reader-themes-reader-themesjson
import { KeyedQueue } from "../async/index.js";
import { isCustomThemeId, type CustomReaderTheme } from "../model/index.js";

/** Reads and writes the whole reader-themes.json; a missing file reads as null. */
export interface ReaderThemesPort {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

const MAX_NAME_LENGTH = 40;
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** @returns the colour as lowercase #rrggbb, or null when it is not #rgb or #rrggbb. */
export function normalizeHexColour(value: unknown): string | null {
  if (typeof value !== "string") { return null; }
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) { return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase(); }
  return /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") { return null; }
  const name = value.trim();
  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null;
}

function normalizeEntry(value: unknown): CustomReaderTheme | null {
  if (!value || typeof value !== "object") { return null; }
  const raw = value as Record<string, unknown>;
  const id = raw["id"];
  const updatedAt = raw["updatedAt"];
  if (!isCustomThemeId(id) || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt))) { return null; }
  const name = normalizeName(raw["name"]);
  const page = normalizeHexColour(raw["page"]);
  const ink = normalizeHexColour(raw["ink"]);
  if (raw["deleted"] === true) { return { id, name: name ?? "", page: page ?? "#ffffff", ink: ink ?? "#000000", updatedAt, deleted: true }; }
  return name && page && ink ? { id, name, page, ink, updatedAt } : null;
}

/**
 * Defensive parse: a corrupt file reads as empty and invalid entries are dropped. Tombstones are kept.
 * @returns the themes, one per id (the newer wins when an id repeats).
 */
export function parseReaderThemes(text: string | null): CustomReaderTheme[] {
  if (text === null) { return []; }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return []; }
  const list = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>)["themes"] : null;
  if (!Array.isArray(list)) { return []; }
  const entries = list.map(normalizeEntry).filter((t): t is CustomReaderTheme => t !== null);
  return mergeReaderThemes(entries, []);
}

/**
 * The exact bytes every app writes: themes sorted by id, fixed key order, two-space indent.
 * @returns the JSON text of the file.
 */
export function serializeReaderThemes(themes: readonly CustomReaderTheme[]): string {
  const sorted = [...themes].sort((a, b) => a.id.localeCompare(b.id));
  const payload = sorted.map((t) => (t.deleted
    ? { id: t.id, name: t.name, page: t.page, ink: t.ink, updatedAt: t.updatedAt, deleted: true }
    : { id: t.id, name: t.name, page: t.page, ink: t.ink, updatedAt: t.updatedAt }));
  return JSON.stringify({ themes: payload }, null, 2);
}

/**
 * Merges two copies of the file (a conflict copy, or a list with repeated ids): per id the newer `updatedAt` wins, so a
 * newer tombstone removes an older theme and a newer edit beats an older tombstone.
 * @returns the merged themes, sorted by id.
 */
export function mergeReaderThemes(a: readonly CustomReaderTheme[], b: readonly CustomReaderTheme[]): CustomReaderTheme[] {
  const byId = new Map<string, CustomReaderTheme>();
  for (const theme of [...a, ...b]) {
    const current = byId.get(theme.id);
    if (!current || theme.updatedAt > current.updatedAt) { byId.set(theme.id, theme); }
  }
  return [...byId.values()].sort((x, y) => x.id.localeCompare(y.id));
}

export interface ReaderThemeStoreOptions {
  now?: () => string;
  newId?: () => string;
}

function randomThemeId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return `c-${Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("")}`;
}

/** Load-modify-save over reader-themes.json, serialized so two saves never drop one another. */
export class ReaderThemeStore {
  private readonly queue = new KeyedQueue();
  private readonly now: () => string;
  private readonly newId: () => string;

  constructor(private readonly port: ReaderThemesPort, options: ReaderThemeStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? randomThemeId;
  }

  /** @returns the live themes (no tombstones), sorted by name. */
  async list(): Promise<CustomReaderTheme[]> {
    const themes = parseReaderThemes(await this.port.read());
    return themes.filter((t) => !t.deleted).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /**
   * Creates a theme when `id` is absent, otherwise replaces the live theme with that id.
   * @returns the saved theme, or null when a field is invalid or the id is unknown; nothing is written then.
   */
  async save(input: { id?: string; name: unknown; page: unknown; ink: unknown }): Promise<CustomReaderTheme | null> {
    const name = normalizeName(input.name);
    const page = normalizeHexColour(input.page);
    const ink = normalizeHexColour(input.ink);
    if (!name || !page || !ink) { return null; }
    return this.mutate((themes) => {
      if (input.id !== undefined && !themes.some((t) => t.id === input.id && !t.deleted)) { return null; }
      const theme: CustomReaderTheme = { id: input.id ?? this.newId(), name, page, ink, updatedAt: this.now() };
      return { themes: mergeReaderThemes(themes.filter((t) => t.id !== theme.id), [theme]), result: theme };
    });
  }

  /** Replaces the theme with a tombstone; an unknown id writes nothing. */
  async remove(id: string): Promise<void> {
    await this.mutate((themes) => {
      const theme = themes.find((t) => t.id === id && !t.deleted);
      if (!theme) { return null; }
      const tombstone: CustomReaderTheme = { ...theme, updatedAt: this.now(), deleted: true };
      return { themes: themes.map((t) => (t.id === id ? tombstone : t)), result: true };
    });
  }

  private async mutate<T>(change: (themes: CustomReaderTheme[]) => { themes: CustomReaderTheme[]; result: T } | null): Promise<T | null> {
    return this.queue.run("themes", async () => {
      const next = change(parseReaderThemes(await this.port.read()));
      if (!next) { return null; }
      await this.port.write(serializeReaderThemes(next.themes));
      return next.result;
    });
  }
}
