/** Builds an in-memory Typst project and a language service over it for the language-service tests. */
import type { ILogger } from "../../../../src/ports/index";
import { createTypstLanguageService } from "../../../../src/writing/typst/language/index";

export const PROJECT: Record<string, string> = {
  "lib.typ": "/// Draws a note.\n#let note(body, color: red) = box(body)\n#let helper = 1\n= Lib <lib-sec>\n",
  "chapters/intro.typ": "= Intro <intro>\nSome text.\n",
  "chapters/back.typ": "#bibliography(\"/refs.bib\")\n",
  "refs.bib": "@article{knuth84,\n  title = {Literate {P}rogramming},\n  author = {Knuth, Donald E.},\n  year = {1984},\n}\n",
  "figs/plot.png": "",
  "data.csv": "a,b\n",
  "main.typ": "",
};

/** The edited file's text before the cursor part: an import, an include, a documented binding and a label. */
export const MAIN = "#import \"lib.typ\": note\n#include \"chapters/intro.typ\"\n/// The answer.\n#let answer = 42\n= Main <main-sec>\n";

export function fixture(failing: readonly string[] = []) {
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) } satisfies ILogger;
  const sources = {
    list: async () => Object.keys(PROJECT),
    read: async (path: string) => {
      if (failing.includes(path) || PROJECT[path] === undefined) { throw new Error(`ENOENT: ${path}`); }
      return PROJECT[path]!;
    },
  };
  return { logger, service: createTypstLanguageService({ sources, logger }) };
}

/** Splits `MAIN + marked` at the `|` marker into the text without it and the marker's offset. */
export function at(marked: string, prefix = MAIN): [string, number] {
  const offset = prefix.length + marked.indexOf("|");
  return [prefix + marked.replace("|", ""), offset];
}
