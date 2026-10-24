// Catalogues Typst's introspection category: counters, state, queries, locations and metadata.
import { fn, pos, named, ty, type TypstBuiltin } from "./typstBuiltin";

const SELECTOR = "label | selector | location | function";
const AT = (what: string): TypstBuiltin =>
  fn("at", `The ${what} at a location in the document; needs context.`, [pos("selector", SELECTOR, "Where to read the value, by a location or the first match of a selector.")], "any");

export const INTROSPECTION: readonly TypstBuiltin[] = [
  ty("counter", "Counts pages, elements or anything else, such as `counter(heading)` or `counter(page)`.", [
    pos("key", `str | ${SELECTOR}`, "What to count: an element function, a selector, a label, a location or a string key."),
  ], [
    fn("get", "The counter's value at the current location; needs context.", [], "int | array"),
    AT("counter's value"),
    fn("final", "The counter's value at the end of the document; needs context.", [], "int | array"),
    fn("display", "Shows the counter's current value with a numbering pattern; needs context.", [
      pos("numbering", "auto | str | function", "The numbering pattern or function; `auto` uses the counted element's numbering.", "auto"),
      named("both", "bool", "false", "Whether to show the current and the final value together."),
    ], "any"),
    fn("step", "Increases the counter by one at this place in the document.", [
      named("level", "int", "1", "The depth at which to step, for hierarchical counters such as headings."),
    ], "content"),
    fn("update", "Sets the counter at this place in the document.", [
      pos("update", "int | array | function", "The new value, or a function from the old value to the new one."),
    ], "content"),
  ]),
  ty("state", "A value that changes across the document, read and updated by position.", [
    pos("key", "str", "The key that identifies the state."),
    pos("init", "any", "The initial value.", "none"),
  ], [
    fn("get", "The state's value at the current location; needs context.", [], "any"),
    AT("state's value"),
    fn("final", "The state's value at the end of the document; needs context.", [], "any"),
    fn("update", "Changes the state at this place in the document.", [
      pos("update", "any", "The new value, or a function from the old value to the new one."),
    ], "content"),
  ]),
  fn("query", "Finds all elements in the document that match a selector; needs context.", [
    pos("target", SELECTOR, "What to look for: an element function, a selector, a label or a location."),
  ], "array"),
  fn("locate", "The location of the one element that matches a selector; needs context.", [
    pos("selector", SELECTOR, "The element to find; it must match exactly one."),
  ], "location"),
  fn("here", "The location of the current context; needs context.", [], "location"),
  fn("metadata", "Invisible content that holds a value, for retrieval with `query`.", [
    pos("value", "any", "The value to embed."),
  ], "content"),
  ty("location", "A position in the final document, obtained from `here`, `locate` or an element's `location()`.", undefined, [
    fn("page", "The page number of the location.", [], "int"),
    fn("position", "The page and the x and y coordinates of the location.", [], "dictionary"),
    fn("page-numbering", "The page numbering pattern in effect at the location.", [], "none | str | function"),
  ]),
];
