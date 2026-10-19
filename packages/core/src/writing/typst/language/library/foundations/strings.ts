// Catalogues Typst's string and regular-expression types with their methods.
import { fn, named, pos, ty, type TypstBuiltin } from "../typstBuiltin";

const PATTERN = "str | regex";
const method = (name: string, doc: string, returns: string): TypstBuiltin => fn(name, doc, [], returns);
const search = (name: string, doc: string, returns: string): TypstBuiltin =>
  fn(name, doc, [pos("pattern", PATTERN, "The string or regular expression to search for.")], returns);

export const STRINGS: readonly TypstBuiltin[] = [
  ty("str", "A sequence of Unicode codepoints; `str(..)` converts a value to a string.", [
    pos("value", "int | float | decimal | version | bytes | label | type | str", "The value to convert."),
    named("base", "int", "10", "The base for converting an integer, between 2 and 36."),
  ], [
    method("len", "The length of the string in UTF-8 bytes.", "int"),
    fn("first", "The first grapheme cluster of the string.", [named("default", "str", undefined, "Returned if the string is empty.")], "str"),
    fn("last", "The last grapheme cluster of the string.", [named("default", "str", undefined, "Returned if the string is empty.")], "str"),
    fn("at", "The grapheme cluster at a byte index.", [
      pos("index", "int", "The byte index; negative counts from the end."),
      named("default", "any", undefined, "Returned if the index is out of bounds."),
    ], "any"),
    fn("slice", "A substring between two byte indices.", [
      pos("start", "int", "The start byte index, inclusive."),
      pos("end", "none | int", "The end byte index, exclusive; `none` means the end of the string.", "none"),
      named("count", "int", undefined, "The number of bytes to take, instead of `end`."),
    ], "str"),
    method("clusters", "The grapheme clusters of the string as an array.", "array"),
    method("codepoints", "The Unicode codepoints of the string as an array.", "array"),
    fn("to-unicode", "The Unicode codepoint of a single character.", [pos("character", "str", "The character.")], "int"),
    fn("from-unicode", "The character of a Unicode codepoint.", [pos("value", "int", "The codepoint.")], "str"),
    fn("normalize", "Normalizes the string to a Unicode normalization form.", [
      named("form", "str", "\"nfc\"", "The form: `\"nfc\"`, `\"nfd\"`, `\"nfkc\"` or `\"nfkd\"`."),
    ], "str"),
    search("contains", "Whether the string contains the pattern.", "bool"),
    search("starts-with", "Whether the string starts with the pattern.", "bool"),
    search("ends-with", "Whether the string ends with the pattern.", "bool"),
    search("find", "The first match of the pattern as a string, or `none`.", "none | str"),
    search("position", "The byte index of the first match of the pattern, or `none`.", "none | int"),
    search("match", "Details about the first match of the pattern, or `none`.", "none | dictionary"),
    search("matches", "Details about every match of the pattern.", "array"),
    fn("replace", "Replaces matches of the pattern with a string or the result of a function.", [
      pos("pattern", PATTERN, "The string or regular expression to replace."),
      pos("replacement", "str | function", "The replacement, or a function of the match details."),
      named("count", "int", undefined, "How many matches to replace at most."),
    ], "str"),
    fn("trim", "Removes matches of a pattern, or whitespace, from the ends of the string.", [
      pos("pattern", "none | str | regex", "What to remove; `none` removes whitespace.", "none"),
      named("at", "alignment", undefined, "Which end to trim, `start` or `end`; both by default."),
      named("repeat", "bool", "true", "Whether to remove repeated matches, not just one."),
    ], "str"),
    fn("split", "Splits the string at matches of a pattern, or at whitespace.", [
      pos("pattern", "none | str | regex", "Where to split; `none` splits at whitespace.", "none"),
    ], "array"),
    method("rev", "The string with its grapheme clusters reversed.", "str"),
  ]),
  ty("regex", "A regular expression, used for searching strings and in `show` rules.", [
    pos("regex", "str", "The regular expression, in Rust regex syntax."),
  ], []),
];
