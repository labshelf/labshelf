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
