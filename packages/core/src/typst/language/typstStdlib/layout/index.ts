// Catalogues Typst's layout category.
import type { TypstBuiltin } from "../typstBuiltin";
import { BOXES } from "./boxes";
import { createCellGrid } from "./createCellGrid";
import { PAGES } from "./pages";
import { VALUES } from "./lengths";

export { createCellGrid, type TypstGridKind } from "./createCellGrid";

export const LAYOUT: readonly TypstBuiltin[] = [
  ...PAGES,
  ...BOXES,
  ...createCellGrid({ name: "grid", inset: "(:)", stroke: "(:)" }, "Arranges content in a grid of rows and columns, with optional gutters, fills and strokes."),
  ...VALUES,
];
