// Catalogues Typst's structural value types: content, label, bytes, version, arguments, function, selector, symbol.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, createVariadicParam, type TypstBuiltin } from "./typstBuiltin";

const method = (name: string, doc: string, returns: string): TypstBuiltin => createFunctionBuiltin(name, doc, [], returns);
const fallback = (doc: string) => createNamedParam("default", "any", undefined, doc);
const BOUND = "label | selector | location | function";

export const VALUES: readonly TypstBuiltin[] = [
  createTypeBuiltin("content", "A piece of document content, written in square brackets `[..]`.", undefined, [
    method("func", "The element function that made this content.", "function"),
    createFunctionBuiltin("has", "Whether the content has a field.", [createPositionalParam("field", "str", "The field name.")], "bool"),
    createFunctionBuiltin("at", "The value of a field.", [createPositionalParam("field", "str", "The field name."), fallback("Returned if the field is missing.")], "any"),
    method("fields", "All fields of the content as a dictionary.", "dictionary"),
    method("location", "The location of the content in the document, or `none`.", "none | location"),
  ]),
  createTypeBuiltin("label", "A name attached to an element, written `<name>`, for references and selectors.", [
    createPositionalParam("name", "str", "The name of the label."),
  ], []),
  createTypeBuiltin("bytes", "A sequence of bytes, such as the contents of a binary file.", [
    createPositionalParam("value", "str | bytes | array", "The value to convert to bytes."),
  ], [
    method("len", "The number of bytes.", "int"),
    createFunctionBuiltin("at", "The byte at an index.", [createPositionalParam("index", "int", "The index; negative counts from the end."), fallback("Returned if the index is out of bounds.")], "any"),
    createFunctionBuiltin("slice", "The bytes between two indices.", [
      createPositionalParam("start", "int", "The start index, inclusive."),
      createPositionalParam("end", "none | int", "The end index, exclusive; `none` means the end.", "none"),
      createNamedParam("count", "int", undefined, "The number of bytes to take, instead of `end`."),
    ], "bytes"),
  ]),
  createTypeBuiltin("version", "A version number with any number of components, such as `version(0, 14, 2)`.", [
    createVariadicParam("components", "int | array", "The components of the version."),
  ], [
    createFunctionBuiltin("at", "The component at an index; missing components are 0.", [createPositionalParam("index", "int", "The index.")], "int"),
  ]),
  createTypeBuiltin("arguments", "Captured positional and named arguments, as in `(..args) => ..`.", [
    createVariadicParam("arguments", "any", "The arguments to capture."),
  ], [
    createFunctionBuiltin("at", "A positional argument by index or a named one by name.", [
      createPositionalParam("key", "int | str", "The index or name."), fallback("Returned if the argument is missing."),
    ], "any"),
    method("pos", "The positional arguments as an array.", "array"),
    method("named", "The named arguments as a dictionary.", "dictionary"),
  ]),
  createTypeBuiltin("function", "A function that can be called, and for elements styled with `set` and `show`.", undefined, [
    createFunctionBuiltin("with", "The function with some arguments applied in advance.", [createVariadicParam("arguments", "any", "The arguments to apply.")], "function"),
    createFunctionBuiltin("where", "A selector for the element function's elements whose fields match.", [
      createVariadicParam("fields", "any", "The field values to match, as named arguments."),
    ], "selector"),
  ]),
  createTypeBuiltin("selector", "A filter for elements, used by `show` rules, `query` and counters.", [
    createPositionalParam("target", "str | regex | label | selector | location | function", "The element, label or pattern to select."),
  ], [
    createFunctionBuiltin("or", "A selector matching any of several selectors.", [createVariadicParam("others", "selector", "The other selectors.")], "selector"),
    createFunctionBuiltin("and", "A selector matching all of several selectors.", [createVariadicParam("others", "selector", "The other selectors.")], "selector"),
    createFunctionBuiltin("before", "Restricts the selector to elements before a point.", [
      createPositionalParam("end", BOUND, "The point to stop at."), createNamedParam("inclusive", "bool", "true", "Whether elements at the point match."),
    ], "selector"),
    createFunctionBuiltin("after", "Restricts the selector to elements after a point.", [
      createPositionalParam("start", BOUND, "The point to start at."), createNamedParam("inclusive", "bool", "true", "Whether elements at the point match."),
    ], "selector"),
  ]),
  createTypeBuiltin("symbol", "A Unicode symbol with named variants, such as `sym.arrow.r`.", [
    createVariadicParam("variants", "str | array", "The default symbol, then `(modifiers, symbol)` pairs."),
  ], []),
];
