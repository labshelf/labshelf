// Catalogues Typst's visualize category: shapes, images, colours, gradients, tilings and strokes.
import type { TypstBuiltin } from "../typstBuiltin";
import { PAINTS } from "./paint";
import { SHAPES } from "./shapes";

export const VISUALIZE: readonly TypstBuiltin[] = [...SHAPES, ...PAINTS];
