// Catalogues Typst's foundations category: core types, calculations and evaluation.
import type { TypstBuiltin } from "../typstBuiltin";
import { CALC } from "./calc";
import { COLLECTIONS } from "./collections";
import { EVALUATION } from "./evaluation";
import { NUMBERS } from "./numbers";
import { STRINGS } from "./strings";
import { TIME } from "./time";
import { VALUES } from "./values";

export const FOUNDATIONS: readonly TypstBuiltin[] = [
  ...NUMBERS, ...STRINGS, ...COLLECTIONS, ...TIME, ...VALUES, ...EVALUATION, CALC,
];
