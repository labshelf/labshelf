// Typst's value types and evaluation helpers: numbers, strings, collections, time, content values, assertions and evaluation.
import { createFallbackParam, createFunctionBuiltin, createMethodBuiltin, createModuleBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, createConstantBuiltin, createVariadicParam, type TypstBuiltin } from "./typstBuiltin";

// Catalogues Typst's boolean and numeric types (bool, int, float, decimal) with their methods.
const bitwise = (name: string, doc: string) => createFunctionBuiltin(name, doc, [createPositionalParam("rhs", "int", "The right-hand operand.")], "int");
const endian = createNamedParam("endian", "str", "\"little\"", "The byte order, `\"big\"` or `\"little\"`.");

export const NUMBERS: readonly TypstBuiltin[] = [
  createTypeBuiltin("bool", "A value that is either `true` or `false`.", undefined, []),
  createTypeBuiltin("int", "A whole number; `int(..)` converts a value to an integer.", [
    createPositionalParam("value", "bool | int | float | decimal | str", "The value to convert."),
  ], [
    createMethodBuiltin("signum", "The sign of the integer: -1, 0 or 1.", "int"),
    createMethodBuiltin("bit-not", "The bitwise NOT of the integer.", "int"),
    bitwise("bit-and", "The bitwise AND of two integers."),
    bitwise("bit-or", "The bitwise OR of two integers."),
    bitwise("bit-xor", "The bitwise XOR of two integers."),
    createFunctionBuiltin("bit-lshift", "Shifts the bits to the left.", [createPositionalParam("shift", "int", "How many bits to shift.")], "int"),
    createFunctionBuiltin("bit-rshift", "Shifts the bits to the right.", [
      createPositionalParam("shift", "int", "How many bits to shift."),
      createNamedParam("logical", "bool", "false", "Whether to fill with zeros instead of the sign bit."),
    ], "int"),
    createFunctionBuiltin("from-bytes", "Reads an integer from bytes.", [
      createPositionalParam("bytes", "bytes", "The bytes to read, at most eight."), endian,
      createNamedParam("signed", "bool", "true", "Whether the bytes hold a signed integer."),
    ], "int"),
    createFunctionBuiltin("to-bytes", "Writes the integer as bytes.", [endian, createNamedParam("size", "int", "8", "The number of bytes.")], "bytes"),
  ]),
  createTypeBuiltin("float", "A 64-bit floating-point number; `float(..)` converts a value to a float.", [
    createPositionalParam("value", "bool | int | float | decimal | ratio | str", "The value to convert."),
  ], [
    createMethodBuiltin("is-nan", "Whether the float is not a number.", "bool"),
    createMethodBuiltin("is-infinite", "Whether the float is infinite.", "bool"),
    createMethodBuiltin("signum", "The sign of the float: -1.0 or 1.0, or NaN.", "float"),
    createFunctionBuiltin("from-bytes", "Reads a float from four or eight bytes.", [createPositionalParam("bytes", "bytes", "The bytes to read."), endian], "float"),
    createFunctionBuiltin("to-bytes", "Writes the float as bytes.", [endian, createNamedParam("size", "int", "8", "The number of bytes, 4 or 8.")], "bytes"),
  ]),
  createTypeBuiltin("decimal", "An exact decimal number, made with `decimal(\"1.5\")` to avoid floating-point error.", [
    createPositionalParam("value", "bool | int | float | str | decimal", "The value to convert; a string keeps every digit exactly."),
  ], []),
];

// Catalogues Typst's string and regular-expression types with their methods.
const PATTERN = "str | regex";
const search = (name: string, doc: string, returns: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam("pattern", PATTERN, "The string or regular expression to search for.")], returns);

export const STRINGS: readonly TypstBuiltin[] = [
  createTypeBuiltin("str", "A sequence of Unicode codepoints; `str(..)` converts a value to a string.", [
    createPositionalParam("value", "int | float | decimal | version | bytes | label | type | str", "The value to convert."),
    createNamedParam("base", "int", "10", "The base for converting an integer, between 2 and 36."),
  ], [
    createMethodBuiltin("len", "The length of the string in UTF-8 bytes.", "int"),
    createFunctionBuiltin("first", "The first grapheme cluster of the string.", [createNamedParam("default", "str", undefined, "Returned if the string is empty.")], "str"),
    createFunctionBuiltin("last", "The last grapheme cluster of the string.", [createNamedParam("default", "str", undefined, "Returned if the string is empty.")], "str"),
    createFunctionBuiltin("at", "The grapheme cluster at a byte index.", [
      createPositionalParam("index", "int", "The byte index; negative counts from the end."),
      createNamedParam("default", "any", undefined, "Returned if the index is out of bounds."),
    ], "any"),
    createFunctionBuiltin("slice", "A substring between two byte indices.", [
      createPositionalParam("start", "int", "The start byte index, inclusive."),
      createPositionalParam("end", "none | int", "The end byte index, exclusive; `none` means the end of the string.", "none"),
      createNamedParam("count", "int", undefined, "The number of bytes to take, instead of `end`."),
    ], "str"),
    createMethodBuiltin("clusters", "The grapheme clusters of the string as an array.", "array"),
    createMethodBuiltin("codepoints", "The Unicode codepoints of the string as an array.", "array"),
    createFunctionBuiltin("to-unicode", "The Unicode codepoint of a single character.", [createPositionalParam("character", "str", "The character.")], "int"),
    createFunctionBuiltin("from-unicode", "The character of a Unicode codepoint.", [createPositionalParam("value", "int", "The codepoint.")], "str"),
    createFunctionBuiltin("normalize", "Normalizes the string to a Unicode normalization form.", [
      createNamedParam("form", "str", "\"nfc\"", "The form: `\"nfc\"`, `\"nfd\"`, `\"nfkc\"` or `\"nfkd\"`."),
    ], "str"),
    search("contains", "Whether the string contains the pattern.", "bool"),
    search("starts-with", "Whether the string starts with the pattern.", "bool"),
    search("ends-with", "Whether the string ends with the pattern.", "bool"),
    search("find", "The first match of the pattern as a string, or `none`.", "none | str"),
    search("position", "The byte index of the first match of the pattern, or `none`.", "none | int"),
    search("match", "Details about the first match of the pattern, or `none`.", "none | dictionary"),
    search("matches", "Details about every match of the pattern.", "array"),
    createFunctionBuiltin("replace", "Replaces matches of the pattern with a string or the result of a function.", [
      createPositionalParam("pattern", PATTERN, "The string or regular expression to replace."),
      createPositionalParam("replacement", "str | function", "The replacement, or a function of the match details."),
      createNamedParam("count", "int", undefined, "How many matches to replace at most."),
    ], "str"),
    createFunctionBuiltin("trim", "Removes matches of a pattern, or whitespace, from the ends of the string.", [
      createPositionalParam("pattern", "none | str | regex", "What to remove; `none` removes whitespace.", "none"),
      createNamedParam("at", "alignment", undefined, "Which end to trim, `start` or `end`; both by default."),
      createNamedParam("repeat", "bool", "true", "Whether to remove repeated matches, not just one."),
    ], "str"),
    createFunctionBuiltin("split", "Splits the string at matches of a pattern, or at whitespace.", [
      createPositionalParam("pattern", "none | str | regex", "Where to split; `none` splits at whitespace.", "none"),
    ], "array"),
    createMethodBuiltin("rev", "The string with its grapheme clusters reversed.", "str"),
  ]),
  createTypeBuiltin("regex", "A regular expression, used for searching strings and in `show` rules.", [
    createPositionalParam("regex", "str", "The regular expression, in Rust regex syntax."),
  ], []),
];

// Catalogues Typst's array and dictionary types with their methods, and the `range` function.
const withFn = (name: string, param: string, doc: string, paramDoc: string, returns: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam(param, "function", paramDoc)], returns);

const RANGE = createFunctionBuiltin("range", "An array of integers from `start` (inclusive) to `end` (exclusive).", [
  createPositionalParam("start", "int", "The first number.", "0"),
  createPositionalParam("end", "int", "The number after the last one."),
  createNamedParam("step", "int", "1", "The distance between numbers."),
], "array");

export const COLLECTIONS: readonly TypstBuiltin[] = [
  createTypeBuiltin("array", "An ordered sequence of values, written `(1, 2, 3)`; `array(..)` converts a value to an array.", [
    createPositionalParam("value", "bytes | array | version", "The value to convert."),
  ], [
    createMethodBuiltin("len", "The number of values in the array.", "int"),
    createFunctionBuiltin("first", "The first value of the array.", [createFallbackParam("Returned if the array is empty.")], "any"),
    createFunctionBuiltin("last", "The last value of the array.", [createFallbackParam("Returned if the array is empty.")], "any"),
    createFunctionBuiltin("at", "The value at an index.", [
      createPositionalParam("index", "int", "The index; negative counts from the end."), createFallbackParam("Returned if the index is out of bounds."),
    ], "any"),
    createFunctionBuiltin("push", "Adds a value to the end of the array.", [createPositionalParam("value", "any", "The value to add.")], "none"),
    createMethodBuiltin("pop", "Removes and returns the last value of the array.", "any"),
    createFunctionBuiltin("insert", "Inserts a value at an index.", [
      createPositionalParam("index", "int", "The index to insert at."), createPositionalParam("value", "any", "The value to insert."),
    ], "none"),
    createFunctionBuiltin("remove", "Removes and returns the value at an index.", [
      createPositionalParam("index", "int", "The index to remove."), createFallbackParam("Returned if the index is out of bounds."),
    ], "any"),
    createFunctionBuiltin("slice", "A subarray between two indices.", [
      createPositionalParam("start", "int", "The start index, inclusive."),
      createPositionalParam("end", "none | int", "The end index, exclusive; `none` means the end of the array.", "none"),
      createNamedParam("count", "int", undefined, "The number of values to take, instead of `end`."),
    ], "array"),
    createFunctionBuiltin("contains", "Whether the array contains a value.", [createPositionalParam("value", "any", "The value to look for.")], "bool"),
    withFn("find", "searcher", "The first value for which the function returns `true`, or `none`.", "The test for each value.", "any"),
    withFn("position", "searcher", "The index of the first value for which the function returns `true`, or `none`.", "The test for each value.", "none | int"),
    { ...RANGE, doc: "An array of integers from `start` (inclusive) to `end` (exclusive), called as `array.range`." },
    withFn("filter", "test", "The values for which the function returns `true`.", "The test for each value.", "array"),
    withFn("map", "mapper", "The results of applying a function to each value.", "The function to apply.", "array"),
    createFunctionBuiltin("enumerate", "Pairs each value with its index.", [createNamedParam("start", "int", "0", "The index of the first value.")], "array"),
    createFunctionBuiltin("zip", "Pairs the values of this array with those of other arrays.", [
      createVariadicParam("others", "array", "The arrays to zip with."),
      createNamedParam("exact", "bool", "false", "Whether all arrays must have the same length."),
    ], "array"),
    createFunctionBuiltin("fold", "Folds all values into one with an accumulator function.", [
      createPositionalParam("init", "any", "The initial accumulator value."),
      createPositionalParam("folder", "function", "Takes the accumulator and a value and returns the next accumulator."),
    ], "any"),
    createFunctionBuiltin("sum", "The sum of all values.", [createFallbackParam("Returned if the array is empty.")], "any"),
    createFunctionBuiltin("product", "The product of all values.", [createFallbackParam("Returned if the array is empty.")], "any"),
    withFn("any", "test", "Whether the function returns `true` for any value.", "The test for each value.", "bool"),
    withFn("all", "test", "Whether the function returns `true` for every value.", "The test for each value.", "bool"),
    createMethodBuiltin("flatten", "Merges nested arrays into one flat array.", "array"),
    createMethodBuiltin("rev", "The array in reverse order.", "array"),
    createFunctionBuiltin("split", "Splits the array at each occurrence of a value.", [createPositionalParam("at", "any", "The value to split at.")], "array"),
    createFunctionBuiltin("join", "Joins all values with a separator.", [
      createPositionalParam("separator", "any", "The value between two items.", "none"),
      createNamedParam("last", "any", undefined, "The value between the last two items."),
      createNamedParam("default", "any", "none", "Returned if the array is empty."),
    ], "any"),
    createFunctionBuiltin("intersperse", "Puts a separator between all values.", [createPositionalParam("separator", "any", "The value to insert.")], "array"),
    createFunctionBuiltin("chunks", "Splits the array into chunks of a given size.", [
      createPositionalParam("chunk-size", "int", "The size of each chunk."),
      createNamedParam("exact", "bool", "false", "Whether to drop a last chunk that is too short."),
    ], "array"),
    createFunctionBuiltin("windows", "Every run of consecutive values of a given size.", [createPositionalParam("window-size", "int", "The size of each window.")], "array"),
    createFunctionBuiltin("sorted", "The array in sorted order.", [
      createNamedParam("key", "function", undefined, "Maps each value to the key to sort by."),
      createNamedParam("by", "function", undefined, "Takes two values and returns whether the first comes before the second."),
    ], "array"),
    createFunctionBuiltin("dedup", "The array without duplicate values.", [
      createNamedParam("key", "function", undefined, "Maps each value to the key to compare by."),
    ], "array"),
    createMethodBuiltin("to-dict", "Converts an array of key-value pairs into a dictionary.", "dictionary"),
    withFn("reduce", "reducer", "Folds all values into one, starting with the first value.", "Takes the accumulator and a value and returns the next accumulator.", "any"),
  ]),
  createTypeBuiltin("dictionary", "A map from string keys to values, written `(a: 1, b: 2)`; `dictionary(..)` converts a module.", [
    createPositionalParam("value", "module", "The module whose definitions to collect."),
  ], [
    createMethodBuiltin("len", "The number of pairs in the dictionary.", "int"),
    createFunctionBuiltin("at", "The value for a key.", [createPositionalParam("key", "str", "The key."), createFallbackParam("Returned if the key is missing.")], "any"),
    createFunctionBuiltin("insert", "Inserts or replaces a pair.", [createPositionalParam("key", "str", "The key."), createPositionalParam("value", "any", "The value.")], "none"),
    createFunctionBuiltin("remove", "Removes a pair and returns its value.", [createPositionalParam("key", "str", "The key."), createFallbackParam("Returned if the key is missing.")], "any"),
    createMethodBuiltin("keys", "The keys of the dictionary in insertion order.", "array"),
    createMethodBuiltin("values", "The values of the dictionary in insertion order.", "array"),
    createMethodBuiltin("pairs", "The key-value pairs of the dictionary as arrays of two.", "array"),
  ]),
  RANGE,
];

// Catalogues Typst's datetime and duration types with their methods.
const part = (name: string) => createNamedParam(name, "int", undefined, `The ${name}.`);
const span = (name: string) => createNamedParam(name, "int", "0", `The number of ${name}.`);

export const TIME: readonly TypstBuiltin[] = [
  createTypeBuiltin("datetime", "A date, a time, or both; give either the full date, the full time, or all six parts.", [
    part("year"), part("month"), part("day"), part("hour"), part("minute"), part("second"),
  ], [
    createFunctionBuiltin("display", "Formats the datetime as a string.", [
      createPositionalParam("pattern", "auto | str", "The format, such as `\"[year]-[month]-[day]\"`; `auto` picks one by the parts present.", "auto"),
    ], "str"),
    createMethodBuiltin("year", "The year, or `none` for a time.", "none | int"),
    createMethodBuiltin("month", "The month, or `none` for a time.", "none | int"),
    createMethodBuiltin("weekday", "The weekday, from 1 (Monday) to 7, or `none` for a time.", "none | int"),
    createMethodBuiltin("day", "The day of the month, or `none` for a time.", "none | int"),
    createMethodBuiltin("hour", "The hour, or `none` for a date.", "none | int"),
    createMethodBuiltin("minute", "The minute, or `none` for a date.", "none | int"),
    createMethodBuiltin("second", "The second, or `none` for a date.", "none | int"),
    createMethodBuiltin("ordinal", "The day of the year, or `none` for a time.", "none | int"),
    createFunctionBuiltin("today", "The current date, called as `datetime.today()`.", [
      createNamedParam("offset", "auto | int", "auto", "The UTC offset in hours; `auto` uses the local time zone."),
    ], "datetime"),
  ]),
  createTypeBuiltin("duration", "A span of time, which results from subtracting two datetimes.", [
    span("seconds"), span("minutes"), span("hours"), span("days"), span("weeks"),
  ], [
    createMethodBuiltin("seconds", "The duration in seconds.", "float"),
    createMethodBuiltin("minutes", "The duration in minutes.", "float"),
    createMethodBuiltin("hours", "The duration in hours.", "float"),
    createMethodBuiltin("days", "The duration in days.", "float"),
    createMethodBuiltin("weeks", "The duration in weeks.", "float"),
  ]),
];

// Catalogues Typst's structural value types: content, label, bytes, version, arguments, function, selector, symbol.
const BOUND = "label | selector | location | function";

export const VALUES: readonly TypstBuiltin[] = [
  createTypeBuiltin("content", "A piece of document content, written in square brackets `[..]`.", undefined, [
    createMethodBuiltin("func", "The element function that made this content.", "function"),
    createFunctionBuiltin("has", "Whether the content has a field.", [createPositionalParam("field", "str", "The field name.")], "bool"),
    createFunctionBuiltin("at", "The value of a field.", [createPositionalParam("field", "str", "The field name."), createFallbackParam("Returned if the field is missing.")], "any"),
    createMethodBuiltin("fields", "All fields of the content as a dictionary.", "dictionary"),
    createMethodBuiltin("location", "The location of the content in the document, or `none`.", "none | location"),
  ]),
  createTypeBuiltin("label", "A name attached to an element, written `<name>`, for references and selectors.", [
    createPositionalParam("name", "str", "The name of the label."),
  ], []),
  createTypeBuiltin("bytes", "A sequence of bytes, such as the contents of a binary file.", [
    createPositionalParam("value", "str | bytes | array", "The value to convert to bytes."),
  ], [
    createMethodBuiltin("len", "The number of bytes.", "int"),
    createFunctionBuiltin("at", "The byte at an index.", [createPositionalParam("index", "int", "The index; negative counts from the end."), createFallbackParam("Returned if the index is out of bounds.")], "any"),
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
      createPositionalParam("key", "int | str", "The index or name."), createFallbackParam("Returned if the argument is missing."),
    ], "any"),
    createMethodBuiltin("pos", "The positional arguments as an array.", "array"),
    createMethodBuiltin("named", "The named arguments as a dictionary.", "dictionary"),
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

// Catalogues Typst's evaluation and system functions: type, repr, panic, assert, eval, plugin and `sys`.
const message = createNamedParam("message", "str", undefined, "The error message if the assertion fails.");
const comparison = (name: string, doc: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam("left", "any", "The first value."), createPositionalParam("right", "any", "The second value."), message], "none");

export const EVALUATION: readonly TypstBuiltin[] = [
  createTypeBuiltin("module", "A collection of definitions, such as `calc` or a file loaded with `import`.", undefined, []),
  createTypeBuiltin("type", "The type of a value; `type(x)` returns it, and types compare with `==`.", [
    createPositionalParam("value", "any", "The value whose type to return."),
  ], []),
  createFunctionBuiltin("repr", "The debug representation of a value as a string.", [createPositionalParam("value", "any", "The value to represent.")], "str"),
  createFunctionBuiltin("panic", "Fails compilation with an error showing the given values.", [
    createVariadicParam("values", "any", "The values to show in the error."),
  ], "none"),
  createFunctionBuiltin("assert", "Fails compilation if a condition is not `true`.", [
    createPositionalParam("condition", "bool", "The condition that must hold."), message,
  ], "none", [
    comparison("eq", "Fails compilation if two values are not equal."),
    comparison("ne", "Fails compilation if two values are equal."),
  ]),
  createFunctionBuiltin("eval", "Evaluates a string as Typst code or markup.", [
    createPositionalParam("source", "str", "The source to evaluate."),
    createNamedParam("mode", "str", "\"code\"", "How to parse the source: `\"code\"`, `\"markup\"` or `\"math\"`."),
    createNamedParam("scope", "dictionary", "(:)", "Variables the source can use."),
  ], "any"),
  createFunctionBuiltin("plugin", "Loads a WebAssembly plugin, whose exported functions become callable.", [
    createPositionalParam("source", "str | bytes", "The path to the `.wasm` file, or its bytes."),
  ], "module"),
  createModuleBuiltin("sys", "Information about the system Typst runs on.", [
    createConstantBuiltin("version", "The version of the Typst compiler, as a `version`."),
    createConstantBuiltin("inputs", "The string inputs given with `--input key=value`, as a dictionary."),
  ]),
];
