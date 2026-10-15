// Maps the core design-token colour roles to ANSI indexes for the TUI.
// PLATFORM: only the 16 ANSI colors are used so the user's terminal theme applies; NO_COLOR drops colors, keeps attributes.
import {
  ANNOTATION_COLORS,
  type AnnotationColor,
  type COLOR_TOKENS,
  type PaperStatus,
  type STATUS_TOKENS,
} from "@labshelf/core";

import type { Style } from "../tui/index.js";

const noColor = Boolean(process.env["NO_COLOR"]);

// Typed by the core role names, so a renamed or removed role fails the build.
const ANSI = {
  error: 1,
  green: 2,
  yellow: 3,
  warning: 3,
  blue: 4,
  link: 4,
} satisfies Partial<Record<keyof typeof COLOR_TOKENS, number>>;

// Core has no role for these two; they are terminal-only accents.
const MAGENTA = 5;
const CYAN = 6;

// An annotation colour added in core fails the build until it has an ANSI index here.
const ANNOTATION_ANSI: Record<AnnotationColor, number> = {
  yellow: ANSI.yellow,
  green: ANSI.green,
  blue: ANSI.blue,
  red: ANSI.error,
  pink: MAGENTA,
};

const STATUS_ANSI: Record<keyof typeof STATUS_TOKENS, Style> = {
  "status-unread": { dim: true },
  "status-reading": { fg: ANSI.yellow, bold: true },
  "status-done": { fg: ANSI.green },
};

function c(style: Style): Style {
  if (!noColor) { return style; }
  const { fg: _fg, bg: _bg, ...rest } = style;
  return rest;
}

export const theme = {
  text: c({}),
  dim: c({ dim: true }),
  bold: c({ bold: true }),
  title: c({ bold: true }),
  brand: c({ fg: ANSI.blue, bold: true }),
  crumb: c({ fg: ANSI.blue }),
  crumbCurrent: c({ fg: ANSI.blue, bold: true }),
  separator: c({ dim: true }),
  collection: c({ fg: ANSI.blue, bold: true }),
  count: c({ dim: true }),
  year: c({ dim: true }),
  noPdf: c({ italic: true }),
  hover: c({ reverse: true }),
  hoverParent: c({ reverse: true, dim: true }),
  selectedMark: c({ fg: MAGENTA, bold: true }),
  cutMark: c({ fg: ANSI.error, bold: true }),
  label: c({ dim: true }),
  tag: c({ fg: CYAN }),
  link: c({ fg: ANSI.link, underline: true }),
  tabActive: c({ reverse: true, bold: true }),
  tabInactive: c({ dim: true }),
  error: c({ fg: ANSI.error, bold: true }),
  warn: c({ fg: ANSI.warning }),
  info: c({ fg: ANSI.green }),
  key: c({ fg: ANSI.yellow, bold: true }),
  popupBorder: c({ fg: ANSI.blue }),
  popupTitle: c({ fg: ANSI.blue, bold: true }),
  mode: {
    NORMAL: c({ fg: ANSI.blue, reverse: true, bold: true }),
    VISUAL: c({ fg: MAGENTA, reverse: true, bold: true }),
    FILTER: c({ fg: ANSI.yellow, reverse: true, bold: true }),
    SEARCH: c({ fg: ANSI.green, reverse: true, bold: true }),
  } as Record<string, Style>,
  status: {
    unread: c(STATUS_ANSI["status-unread"]),
    reading: c(STATUS_ANSI["status-reading"]),
    done: c(STATUS_ANSI["status-done"]),
  } as Record<PaperStatus, Style>,
  annotation: Object.fromEntries(
    ANNOTATION_COLORS.map((name) => [name, c({ fg: ANNOTATION_ANSI[name] })]),
  ) as Record<string, Style>,
  sync: {
    ok: c({ fg: ANSI.green }),
    busy: c({ fg: ANSI.yellow }),
    off: c({ dim: true }),
    error: c({ fg: ANSI.error }),
  },
};

/** Status glyphs: shape and color both carry the state, so it reads without color too. */
export const STATUS_GLYPH: Record<PaperStatus, string> = { unread: "○", reading: "◐", done: "●" };
