// Catalogues Typst's structural value types: content, label, bytes, version, arguments, function, selector, symbol.
import { fn, named, pos, ty, variadic, type TypstBuiltin } from "../typstBuiltin";

const method = (name: string, doc: string, returns: string): TypstBuiltin => fn(name, doc, [], returns);
const fallback = (doc: string) => named("default", "any", undefined, doc);
const BOUND = "label | selector | location | function";

export const VALUES: readonly TypstBuiltin[] = [
  ty("content", "A piece of document content, written in square brackets `[..]`.", undefined, [
    method("func", "The element function that made this content.", "function"),
    fn("has", "Whether the content has a field.", [pos("field", "str", "The field name.")], "bool"),
    fn("at", "The value of a field.", [pos("field", "str", "The field name."), fallback("Returned if the field is missing.")], "any"),
    method("fields", "All fields of the content as a dictionary.", "dictionary"),
    method("location", "The location of the content in the document, or `none`.", "none | location"),
  ]),
  ty("label", "A name attached to an element, written `<name>`, for references and selectors.", [
    pos("name", "str", "The name of the label."),
  ], []),
  ty("bytes", "A sequence of bytes, such as the contents of a binary file.", [
    pos("value", "str | bytes | array", "The value to convert to bytes."),
  ], [
    method("len", "The number of bytes.", "int"),
    fn("at", "The byte at an index.", [pos("index", "int", "The index; negative counts from the end."), fallback("Returned if the index is out of bounds.")], "any"),
    fn("slice", "The bytes between two indices.", [
      pos("start", "int", "The start index, inclusive."),
      pos("end", "none | int", "The end index, exclusive; `none` means the end.", "none"),
      named("count", "int", undefined, "The number of bytes to take, instead of `end`."),
    ], "bytes"),
  ]),
  ty("version", "A version number with any number of components, such as `version(0, 14, 2)`.", [
    variadic("components", "int | array", "The components of the version."),
  ], [
    fn("at", "The component at an index; missing components are 0.", [pos("index", "int", "The index.")], "int"),
  ]),
  ty("arguments", "Captured positional and named arguments, as in `(..args) => ..`.", [
    variadic("arguments", "any", "The arguments to capture."),
  ], [
    fn("at", "A positional argument by index or a named one by name.", [
      pos("key", "int | str", "The index or name."), fallback("Returned if the argument is missing."),
    ], "any"),
    method("pos", "The positional arguments as an array.", "array"),
    method("named", "The named arguments as a dictionary.", "dictionary"),
  ]),
  ty("function", "A function that can be called, and for elements styled with `set` and `show`.", undefined, [
    fn("with", "The function with some arguments applied in advance.", [variadic("arguments", "any", "The arguments to apply.")], "function"),
    fn("where", "A selector for the element function's elements whose fields match.", [
      variadic("fields", "any", "The field values to match, as named arguments."),
    ], "selector"),
  ]),
  ty("selector", "A filter for elements, used by `show` rules, `query` and counters.", [
    pos("target", "str | regex | label | selector | location | function", "The element, label or pattern to select."),
  ], [
    fn("or", "A selector matching any of several selectors.", [variadic("others", "selector", "The other selectors.")], "selector"),
    fn("and", "A selector matching all of several selectors.", [variadic("others", "selector", "The other selectors.")], "selector"),
    fn("before", "Restricts the selector to elements before a point.", [
      pos("end", BOUND, "The point to stop at."), named("inclusive", "bool", "true", "Whether elements at the point match."),
    ], "selector"),
    fn("after", "Restricts the selector to elements after a point.", [
      pos("start", BOUND, "The point to start at."), named("inclusive", "bool", "true", "Whether elements at the point match."),
    ], "selector"),
  ]),
  ty("symbol", "A Unicode symbol with named variants, such as `sym.arrow.r`.", [
    variadic("variants", "str | array", "The default symbol, then `(modifiers, symbol)` pairs."),
  ], []),
];
