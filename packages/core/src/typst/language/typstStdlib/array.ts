// Catalogues Typst's array and dictionary types with their methods, and the `range` function.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, createVariadicParam, type TypstBuiltin } from "./typstBuiltin";

const method = (name: string, doc: string, returns: string): TypstBuiltin => createFunctionBuiltin(name, doc, [], returns);
const withFn = (name: string, param: string, doc: string, paramDoc: string, returns: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam(param, "function", paramDoc)], returns);
const fallback = (doc: string) => createNamedParam("default", "any", undefined, doc);

const RANGE = createFunctionBuiltin("range", "An array of integers from `start` (inclusive) to `end` (exclusive).", [
  createPositionalParam("start", "int", "The first number.", "0"),
  createPositionalParam("end", "int", "The number after the last one."),
  createNamedParam("step", "int", "1", "The distance between numbers."),
], "array");

export const COLLECTIONS: readonly TypstBuiltin[] = [
  createTypeBuiltin("array", "An ordered sequence of values, written `(1, 2, 3)`; `array(..)` converts a value to an array.", [
    createPositionalParam("value", "bytes | array | version", "The value to convert."),
  ], [
    method("len", "The number of values in the array.", "int"),
    createFunctionBuiltin("first", "The first value of the array.", [fallback("Returned if the array is empty.")], "any"),
    createFunctionBuiltin("last", "The last value of the array.", [fallback("Returned if the array is empty.")], "any"),
    createFunctionBuiltin("at", "The value at an index.", [
      createPositionalParam("index", "int", "The index; negative counts from the end."), fallback("Returned if the index is out of bounds."),
    ], "any"),
    createFunctionBuiltin("push", "Adds a value to the end of the array.", [createPositionalParam("value", "any", "The value to add.")], "none"),
    method("pop", "Removes and returns the last value of the array.", "any"),
    createFunctionBuiltin("insert", "Inserts a value at an index.", [
      createPositionalParam("index", "int", "The index to insert at."), createPositionalParam("value", "any", "The value to insert."),
    ], "none"),
    createFunctionBuiltin("remove", "Removes and returns the value at an index.", [
      createPositionalParam("index", "int", "The index to remove."), fallback("Returned if the index is out of bounds."),
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
    createFunctionBuiltin("sum", "The sum of all values.", [fallback("Returned if the array is empty.")], "any"),
    createFunctionBuiltin("product", "The product of all values.", [fallback("Returned if the array is empty.")], "any"),
    withFn("any", "test", "Whether the function returns `true` for any value.", "The test for each value.", "bool"),
    withFn("all", "test", "Whether the function returns `true` for every value.", "The test for each value.", "bool"),
    method("flatten", "Merges nested arrays into one flat array.", "array"),
    method("rev", "The array in reverse order.", "array"),
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
    method("to-dict", "Converts an array of key-value pairs into a dictionary.", "dictionary"),
    withFn("reduce", "reducer", "Folds all values into one, starting with the first value.", "Takes the accumulator and a value and returns the next accumulator.", "any"),
  ]),
  createTypeBuiltin("dictionary", "A map from string keys to values, written `(a: 1, b: 2)`; `dictionary(..)` converts a module.", [
    createPositionalParam("value", "module", "The module whose definitions to collect."),
  ], [
    method("len", "The number of pairs in the dictionary.", "int"),
    createFunctionBuiltin("at", "The value for a key.", [createPositionalParam("key", "str", "The key."), fallback("Returned if the key is missing.")], "any"),
    createFunctionBuiltin("insert", "Inserts or replaces a pair.", [createPositionalParam("key", "str", "The key."), createPositionalParam("value", "any", "The value.")], "none"),
    createFunctionBuiltin("remove", "Removes a pair and returns its value.", [createPositionalParam("key", "str", "The key."), fallback("Returned if the key is missing.")], "any"),
    method("keys", "The keys of the dictionary in insertion order.", "array"),
    method("values", "The values of the dictionary in insertion order.", "array"),
    method("pairs", "The key-value pairs of the dictionary as arrays of two.", "array"),
  ]),
  RANGE,
];
