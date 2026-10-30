/**
 * Declares the reader page themes, which version of a paper its PDF is as the source labelled it, and how the
 * versions rank.
 */
export const PDF_THEMES = ["auto", "light", "dark", "sepia", "high-contrast"] as const;
export type PdfTheme = (typeof PDF_THEMES)[number];

/**
 * @returns true when `value` is one of the reader themes.
 */
export function isPdfTheme(value: unknown): value is PdfTheme {
  return (PDF_THEMES as readonly unknown[]).includes(value);
}

/** A theme the user made: page and ink colours as lowercase #rrggbb, kept in the library's reader-themes.json. */
export interface CustomReaderTheme {
  id: string;
  name: string;
  page: string;
  ink: string;
  updatedAt: string;
  /** A tombstone: the theme was deleted, kept so a stale copy of the file cannot bring it back. */
  deleted?: true;
}

const CUSTOM_THEME_ID = /^c-[a-z0-9]{8}$/;
const CUSTOM_THEME_PREFIX = "custom:";

/** What a paper's data.json stores: a preset name or `custom:<id>`. */
export type ReaderThemeRef = PdfTheme | `custom:${string}`;

export function isCustomThemeId(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_THEME_ID.test(value);
}

export function isReaderThemeRef(value: unknown): value is ReaderThemeRef {
  return isPdfTheme(value) || (typeof value === "string" && value.startsWith(CUSTOM_THEME_PREFIX) && isCustomThemeId(value.slice(CUSTOM_THEME_PREFIX.length)));
}

/** @returns the custom theme id a ref points at, or null for a preset. */
export function customThemeIdOf(ref: ReaderThemeRef): string | null {
  return ref.startsWith(CUSTOM_THEME_PREFIX) ? ref.slice(CUSTOM_THEME_PREFIX.length) : null;
}

export function toCustomThemeRef(id: string): ReaderThemeRef {
  return `${CUSTOM_THEME_PREFIX}${id}`;
}

/** How the reader lays out pages, remembered per paper. */
export const SCROLL_MODES = ["vertical", "horizontal", "wrapped"] as const;
export type ScrollMode = (typeof SCROLL_MODES)[number];
export const SPREAD_MODES = ["none", "odd", "even"] as const;
export type SpreadMode = (typeof SPREAD_MODES)[number];

export interface ReaderView {
  scroll: ScrollMode;
  spread: SpreadMode;
}

/** @returns a valid view, or null when either mode is missing or unknown. */
export function normalizeReaderView(value: unknown): ReaderView | null {
  if (!value || typeof value !== "object") { return null; }
  const { scroll, spread } = value as Record<string, unknown>;
  const scrollOk = (SCROLL_MODES as readonly unknown[]).includes(scroll);
  const spreadOk = (SPREAD_MODES as readonly unknown[]).includes(spread);
  return scrollOk && spreadOk ? { scroll: scroll as ScrollMode, spread: spread as SpreadMode } : null;
}

export const PDF_VERSIONS = ["preprint", "accepted", "published"] as const;
export type PdfVersion = (typeof PDF_VERSIONS)[number];

export const PDF_VERSION_LABEL: Record<PdfVersion, string> = { preprint: "Preprint", accepted: "Accepted", published: "Published" };

export function isPdfVersion(value: unknown): value is PdfVersion {
  return (PDF_VERSIONS as readonly unknown[]).includes(value);
}

// An unlabelled copy ranks with the published one: most come from the publisher or a mirror of its file.
function tier(version: PdfVersion | undefined): number {
  return version === "preprint" ? 2 : version === "accepted" ? 1 : 0;
}

/** True for a preprint or an accepted manuscript, which a published copy would replace. */
export function isPrePublication(version: PdfVersion | null | undefined): version is "preprint" | "accepted" {
  return version === "preprint" || version === "accepted";
}

/** True when a copy of version `a` is preferred over one of version `b`; unknown counts as published. */
export function isPreferredVersion(a: PdfVersion | undefined, b: PdfVersion | undefined): boolean {
  return tier(a) < tier(b);
}

/** Compares two versions for sorting, preferred first. */
export function compareVersions(a: PdfVersion | undefined, b: PdfVersion | undefined): number {
  return tier(a) - tier(b);
}
