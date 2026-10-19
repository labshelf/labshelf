// Catalogues Typst's layout category.
import type { TypstBuiltin } from "../typstBuiltin";
import { BOXES } from "./boxes";
import { cellGrid } from "./cellGrid";
import { PAGES } from "./pages";
import { VALUES } from "./values";

export { cellGrid, type TypstGridKind } from "./cellGrid";

export const LAYOUT: readonly TypstBuiltin[] = [
  ...PAGES,
  ...BOXES,
  ...cellGrid({ name: "grid", inset: "(:)", stroke: "(:)" }, "Arranges content in a grid of rows and columns, with optional gutters, fills and strokes."),
  ...VALUES,
];
