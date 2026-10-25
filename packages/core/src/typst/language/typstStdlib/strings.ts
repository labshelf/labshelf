// Catalogues Typst's string and regular-expression types with their methods.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, type TypstBuiltin } from "./typstBuiltin";

const PATTERN = "str | regex";
const method = (name: string, doc: string, returns: string): TypstBuiltin => createFunctionBuiltin(name, doc, [], returns);
const search = (name: string, doc: string, returns: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam("pattern", PATTERN, "The string or regular expression to search for.")], returns);

export const STRINGS: readonly TypstBuiltin[] = [
  createTypeBuiltin("str", "A sequence of Unicode codepoints; `str(..)` converts a value to a string.", [
    createPositionalParam("value", "int | float | decimal | version | bytes | label | type | str", "The value to convert."),
    createNamedParam("base", "int", "10", "The base for converting an integer, between 2 and 36."),
  ], [
    method("len", "The length of the string in UTF-8 bytes.", "int"),
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
    method("clusters", "The grapheme clusters of the string as an array.", "array"),
    method("codepoints", "The Unicode codepoints of the string as an array.", "array"),
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
    method("rev", "The string with its grapheme clusters reversed.", "str"),
  ]),
  createTypeBuiltin("regex", "A regular expression, used for searching strings and in `show` rules.", [
    createPositionalParam("regex", "str", "The regular expression, in Rust regex syntax."),
  ], []),
];
