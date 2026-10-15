// Combines the catalog data into the command list and the environment list.
import { BASE_COMMANDS } from "./baseCommands.js";
import type { LatexCatalogEntry } from "./latexCatalogEntry.js";
import { ENVIRONMENTS } from "./environments.js";
import { MATH_COMMANDS } from "./mathCommands.js";
import { PACKAGE_COMMANDS } from "./packageCommands.js";

export const LATEX_COMMANDS: readonly LatexCatalogEntry[] = [...BASE_COMMANDS, ...MATH_COMMANDS, ...PACKAGE_COMMANDS];
export const LATEX_ENVIRONMENTS: readonly LatexCatalogEntry[] = ENVIRONMENTS;
