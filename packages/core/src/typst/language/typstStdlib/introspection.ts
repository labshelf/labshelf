// Catalogues Typst's introspection category: counters, state, queries, locations and metadata.
import { createFunctionBuiltin, createPositionalParam, createNamedParam, createTypeBuiltin, type TypstBuiltin } from "./typstBuiltin";

const SELECTOR = "label | selector | location | function";
const AT = (what: string): TypstBuiltin =>
  createFunctionBuiltin("at", `The ${what} at a location in the document; needs context.`, [createPositionalParam("selector", SELECTOR, "Where to read the value, by a location or the first match of a selector.")], "any");

export const INTROSPECTION: readonly TypstBuiltin[] = [
  createTypeBuiltin("counter", "Counts pages, elements or anything else, such as `counter(heading)` or `counter(page)`.", [
    createPositionalParam("key", `str | ${SELECTOR}`, "What to count: an element function, a selector, a label, a location or a string key."),
  ], [
    createFunctionBuiltin("get", "The counter's value at the current location; needs context.", [], "int | array"),
    AT("counter's value"),
    createFunctionBuiltin("final", "The counter's value at the end of the document; needs context.", [], "int | array"),
    createFunctionBuiltin("display", "Shows the counter's current value with a numbering pattern; needs context.", [
      createPositionalParam("numbering", "auto | str | function", "The numbering pattern or function; `auto` uses the counted element's numbering.", "auto"),
      createNamedParam("both", "bool", "false", "Whether to show the current and the final value together."),
    ], "any"),
    createFunctionBuiltin("step", "Increases the counter by one at this place in the document.", [
      createNamedParam("level", "int", "1", "The depth at which to step, for hierarchical counters such as headings."),
    ], "content"),
    createFunctionBuiltin("update", "Sets the counter at this place in the document.", [
      createPositionalParam("update", "int | array | function", "The new value, or a function from the old value to the new one."),
    ], "content"),
  ]),
  createTypeBuiltin("state", "A value that changes across the document, read and updated by position.", [
    createPositionalParam("key", "str", "The key that identifies the state."),
    createPositionalParam("init", "any", "The initial value.", "none"),
  ], [
    createFunctionBuiltin("get", "The state's value at the current location; needs context.", [], "any"),
    AT("state's value"),
    createFunctionBuiltin("final", "The state's value at the end of the document; needs context.", [], "any"),
    createFunctionBuiltin("update", "Changes the state at this place in the document.", [
      createPositionalParam("update", "any", "The new value, or a function from the old value to the new one."),
    ], "content"),
  ]),
  createFunctionBuiltin("query", "Finds all elements in the document that match a selector; needs context.", [
    createPositionalParam("target", SELECTOR, "What to look for: an element function, a selector, a label or a location."),
  ], "array"),
  createFunctionBuiltin("locate", "The location of the one element that matches a selector; needs context.", [
    createPositionalParam("selector", SELECTOR, "The element to find; it must match exactly one."),
  ], "location"),
  createFunctionBuiltin("here", "The location of the current context; needs context.", [], "location"),
  createFunctionBuiltin("metadata", "Invisible content that holds a value, for retrieval with `query`.", [
    createPositionalParam("value", "any", "The value to embed."),
  ], "content"),
  createTypeBuiltin("location", "A position in the final document, obtained from `here`, `locate` or an element's `location()`.", undefined, [
    createFunctionBuiltin("page", "The page number of the location.", [], "int"),
    createFunctionBuiltin("position", "The page and the x and y coordinates of the location.", [], "dictionary"),
    createFunctionBuiltin("page-numbering", "The page numbering pattern in effect at the location.", [], "none | str | function"),
  ]),
];
