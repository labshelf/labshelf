// The theme lines of a LaTeX or Typst talk or poster: beamer `\usetheme` and `\usecolortheme`, tikzposter `\usetheme` and
// `\usecolorstyle`, and a Typst source's heading accent colour; each read with its range and rewritten in place, or added when absent.
import type { SourceDeckChange } from "./sourceDeckEdit.js";
import type { SourceDeckFormat } from "./sourceDecks.js";

/** The theme commands a LaTeX class reads: the layout theme and the colour theme or style. */
export type SourceDeckThemeSlot = "theme" | "color";

const BEAMER_THEMES = ["default", "AnnArbor", "Antibes", "Bergen", "Berkeley", "Berlin", "Boadilla", "CambridgeUS", "Copenhagen", "Darmstadt", "Dresden", "Frankfurt", "Goettingen", "Hannover", "Ilmenau", "JuanLesPins", "Luebeck", "Madrid", "Malmoe", "Marburg", "Montpellier", "PaloAlto", "Pittsburgh", "Rochester", "Singapore", "Szeged", "Warsaw", "metropolis"];
const BEAMER_COLORS = ["default", "albatross", "beaver", "beetle", "crane", "dolphin", "dove", "fly", "lily", "orchid", "rose", "seagull", "seahorse", "whale", "wolverine"];
const TIKZ_THEMES = ["Default", "Rays", "Basic", "Simple", "Envelope", "Wave", "Board", "Autumn", "Desert"];
const TIKZ_COLORS = ["Default", "Australia", "Britain", "Sweden", "Spain", "Russia", "Denmark", "Germany"];

const CLASS = /\\documentclass\s*(?:\[[^\]]*\])?\s*\{([A-Za-z0-9-]+)\}/;

/** The LaTeX class whose themes the source uses, or undefined when it is neither beamer nor tikzposter. */
function themeClass(text: string): "beamer" | "tikzposter" | undefined {
  const name = CLASS.exec(text)?.[1];
  return name === "beamer" || name === "tikzposter" ? name : undefined;
}

const COMMAND: Record<"beamer" | "tikzposter", Record<SourceDeckThemeSlot, string>> = {
  beamer: { theme: "usetheme", color: "usecolortheme" },
  tikzposter: { theme: "usetheme", color: "usecolorstyle" },
};

/** The names a LaTeX source's class offers for each slot; undefined for Typst or another class. */
export function listSourceDeckThemes(format: SourceDeckFormat, text: string): Record<SourceDeckThemeSlot, string[]> | undefined {
  const kind = format === "latex" ? themeClass(text) : undefined;
  if (!kind) return undefined;
  return kind === "beamer" ? { theme: BEAMER_THEMES, color: BEAMER_COLORS } : { theme: TIKZ_THEMES, color: TIKZ_COLORS };
}

/** The first uncommented `\command{name}` line, with the range of its name. */
function findCommand(text: string, command: string): { value: string; range: [number, number] } | undefined {
  const re = new RegExp(`^([^%\\n]*?)\\\\${command}\\s*(?:\\[[^\\]]*\\])?\\s*\\{([^}]*)\\}`, "gm");
  const match = re.exec(text);
  if (!match) return undefined;
  const end = match.index + match[0].length - 1;
  return { value: match[2]!.trim(), range: [end - match[2]!.length, end] };
}

/** The theme a LaTeX source names in a slot, or undefined. */
export function readSourceDeckTheme(format: SourceDeckFormat, text: string, slot: SourceDeckThemeSlot): string | undefined {
  const kind = format === "latex" ? themeClass(text) : undefined;
  return kind && findCommand(text, COMMAND[kind][slot])?.value;
}

/** The text with the slot's theme set to `name`: the name rewritten in place, or the command added on the line after `\documentclass`. Null for Typst or another class. */
export function setSourceDeckTheme(format: SourceDeckFormat, text: string, slot: SourceDeckThemeSlot, name: string): SourceDeckChange | null {
  const kind = format === "latex" ? themeClass(text) : undefined;
  if (!kind || !/^[A-Za-z0-9-]+$/.test(name)) return null;
  const found = findCommand(text, COMMAND[kind][slot]);
  if (found) return { text: text.slice(0, found.range[0]) + name + text.slice(found.range[1]), cursor: found.range[0] + name.length };
  const doc = CLASS.exec(text)!;
  const lineEnd = text.indexOf("\n", doc.index + doc[0].length);
  const at = lineEnd === -1 ? text.length : lineEnd + 1;
  const line = `\\${COMMAND[kind][slot]}{${name}}\n`;
  return { text: text.slice(0, at) + line + text.slice(at), cursor: at + line.length - 1 };
}

const TYPST_ACCENT = /^#show heading[^\n]*?rgb\("(#[0-9a-fA-F]{3,8})"\)/m;

/** The accent colour of a Typst source: the first `rgb("#…")` in a `#show heading` rule, or undefined. */
export function readSourceDeckAccent(text: string): string | undefined {
  return TYPST_ACCENT.exec(text)?.[1];
}

/** The Typst source with its heading accent set to `hex` (#rrggbb): rewritten in place, or a `#show heading` rule added after the last top `#set` line. */
export function setSourceDeckAccent(text: string, hex: string): SourceDeckChange | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const match = TYPST_ACCENT.exec(text);
  if (match) {
    const from = match.index + match[0].lastIndexOf(match[1]!);
    return { text: text.slice(0, from) + hex + text.slice(from + match[1]!.length), cursor: from + hex.length };
  }
  const sets = [...text.matchAll(/^#set [^\n]*\n/gm)];
  const last = sets.at(-1);
  const at = last ? last.index! + last[0].length : 0;
  const rule = `#show heading: set text(fill: rgb("${hex}"))\n`;
  return { text: text.slice(0, at) + rule + text.slice(at), cursor: at + rule.length - 1 };
}
