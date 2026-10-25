/**
 * Declares the fonts the source editor offers, each a family stack that falls back to the monospace token.
 */
import { token, type DesignToken } from "./designToken.js";

export const CODE_FONT_NAMES = ["system", "jetbrains-mono", "fira-code", "atkinson-hyperlegible-mono", "opendyslexic"] as const;
export type CodeFontName = (typeof CODE_FONT_NAMES)[number];

export interface CodeFont {
  label: string;
  family: string;
}

// Every family but the system stack is a font file the browser extension bundles (see its build/vendorFonts.mjs).
export const CODE_FONTS: Record<CodeFontName, CodeFont> = {
  system: { label: "System monospace", family: "var(--ls-mono)" },
  "jetbrains-mono": { label: "JetBrains Mono", family: '"JetBrains Mono", var(--ls-mono)' },
  "fira-code": { label: "Fira Code", family: '"Fira Code", var(--ls-mono)' },
  "atkinson-hyperlegible-mono": { label: "Atkinson Hyperlegible Mono", family: '"Atkinson Hyperlegible Mono", var(--ls-mono)' },
  opendyslexic: { label: "OpenDyslexic", family: '"OpenDyslexic", var(--ls-mono)' },
};

export const CODE_FONT_TOKENS: Record<string, DesignToken> = { "code-font": token(CODE_FONTS.system.family) };

// The library page marks the pick on <html data-code-font>.
export function renderCodeFontsCss(): string {
  return CODE_FONT_NAMES.filter((name) => name !== "system")
    .flatMap((name) => [`:root[data-code-font="${name}"] {`, `  --ls-code-font: ${CODE_FONTS[name].family};`, "}", ""])
    .join("\n");
}
