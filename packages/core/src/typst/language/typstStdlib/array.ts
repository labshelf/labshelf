// Catalogues Typst's array and dictionary types with their methods, and the `range` function.
import { fn, named, pos, ty, variadic, type TypstBuiltin } from "./typstBuiltin";

const method = (name: string, doc: string, returns: string): TypstBuiltin => fn(name, doc, [], returns);
const withFn = (name: string, param: string, doc: string, paramDoc: string, returns: string): TypstBuiltin =>
  fn(name, doc, [pos(param, "function", paramDoc)], returns);
const fallback = (doc: string) => named("default", "any", undefined, doc);

const RANGE = fn("range", "An array of integers from `start` (inclusive) to `end` (exclusive).", [
  pos("start", "int", "The first number.", "0"),
  pos("end", "int", "The number after the last one."),
  named("step", "int", "1", "The distance between numbers."),
], "array");

export const COLLECTIONS: readonly TypstBuiltin[] = [
  ty("array", "An ordered sequence of values, written `(1, 2, 3)`; `array(..)` converts a value to an array.", [
    pos("value", "bytes | array | version", "The value to convert."),
  ], [
    method("len", "The number of values in the array.", "int"),
    fn("first", "The first value of the array.", [fallback("Returned if the array is empty.")], "any"),
    fn("last", "The last value of the array.", [fallback("Returned if the array is empty.")], "any"),
    fn("at", "The value at an index.", [
      pos("index", "int", "The index; negative counts from the end."), fallback("Returned if the index is out of bounds."),
    ], "any"),
    fn("push", "Adds a value to the end of the array.", [pos("value", "any", "The value to add.")], "none"),
    method("pop", "Removes and returns the last value of the array.", "any"),
    fn("insert", "Inserts a value at an index.", [
      pos("index", "int", "The index to insert at."), pos("value", "any", "The value to insert."),
    ], "none"),
    fn("remove", "Removes and returns the value at an index.", [
      pos("index", "int", "The index to remove."), fallback("Returned if the index is out of bounds."),
    ], "any"),
    fn("slice", "A subarray between two indices.", [
      pos("start", "int", "The start index, inclusive."),
      pos("end", "none | int", "The end index, exclusive; `none` means the end of the array.", "none"),
      named("count", "int", undefined, "The number of values to take, instead of `end`."),
    ], "array"),
    fn("contains", "Whether the array contains a value.", [pos("value", "any", "The value to look for.")], "bool"),
    withFn("find", "searcher", "The first value for which the function returns `true`, or `none`.", "The test for each value.", "any"),
    withFn("position", "searcher", "The index of the first value for which the function returns `true`, or `none`.", "The test for each value.", "none | int"),
    { ...RANGE, doc: "An array of integers from `start` (inclusive) to `end` (exclusive), called as `array.range`." },
    withFn("filter", "test", "The values for which the function returns `true`.", "The test for each value.", "array"),
    withFn("map", "mapper", "The results of applying a function to each value.", "The function to apply.", "array"),
    fn("enumerate", "Pairs each value with its index.", [named("start", "int", "0", "The index of the first value.")], "array"),
    fn("zip", "Pairs the values of this array with those of other arrays.", [
      variadic("others", "array", "The arrays to zip with."),
      named("exact", "bool", "false", "Whether all arrays must have the same length."),
    ], "array"),
    fn("fold", "Folds all values into one with an accumulator function.", [
      pos("init", "any", "The initial accumulator value."),
      pos("folder", "function", "Takes the accumulator and a value and returns the next accumulator."),
    ], "any"),
    fn("sum", "The sum of all values.", [fallback("Returned if the array is empty.")], "any"),
    fn("product", "The product of all values.", [fallback("Returned if the array is empty.")], "any"),
    withFn("any", "test", "Whether the function returns `true` for any value.", "The test for each value.", "bool"),
    withFn("all", "test", "Whether the function returns `true` for every value.", "The test for each value.", "bool"),
    method("flatten", "Merges nested arrays into one flat array.", "array"),
    method("rev", "The array in reverse order.", "array"),
    fn("split", "Splits the array at each occurrence of a value.", [pos("at", "any", "The value to split at.")], "array"),
    fn("join", "Joins all values with a separator.", [
      pos("separator", "any", "The value between two items.", "none"),
      named("last", "any", undefined, "The value between the last two items."),
      named("default", "any", "none", "Returned if the array is empty."),
    ], "any"),
    fn("intersperse", "Puts a separator between all values.", [pos("separator", "any", "The value to insert.")], "array"),
    fn("chunks", "Splits the array into chunks of a given size.", [
      pos("chunk-size", "int", "The size of each chunk."),
      named("exact", "bool", "false", "Whether to drop a last chunk that is too short."),
    ], "array"),
    fn("windows", "Every run of consecutive values of a given size.", [pos("window-size", "int", "The size of each window.")], "array"),
    fn("sorted", "The array in sorted order.", [
      named("key", "function", undefined, "Maps each value to the key to sort by."),
      named("by", "function", undefined, "Takes two values and returns whether the first comes before the second."),
    ], "array"),
    fn("dedup", "The array without duplicate values.", [
      named("key", "function", undefined, "Maps each value to the key to compare by."),
    ], "array"),
    method("to-dict", "Converts an array of key-value pairs into a dictionary.", "dictionary"),
    withFn("reduce", "reducer", "Folds all values into one, starting with the first value.", "Takes the accumulator and a value and returns the next accumulator.", "any"),
  ]),
  ty("dictionary", "A map from string keys to values, written `(a: 1, b: 2)`; `dictionary(..)` converts a module.", [
    pos("value", "module", "The module whose definitions to collect."),
  ], [
    method("len", "The number of pairs in the dictionary.", "int"),
    fn("at", "The value for a key.", [pos("key", "str", "The key."), fallback("Returned if the key is missing.")], "any"),
    fn("insert", "Inserts or replaces a pair.", [pos("key", "str", "The key."), pos("value", "any", "The value.")], "none"),
    fn("remove", "Removes a pair and returns its value.", [pos("key", "str", "The key."), fallback("Returned if the key is missing.")], "any"),
    method("keys", "The keys of the dictionary in insertion order.", "array"),
    method("values", "The values of the dictionary in insertion order.", "array"),
    method("pairs", "The key-value pairs of the dictionary as arrays of two.", "array"),
  ]),
  RANGE,
];
