// Catalogues Typst's boolean and numeric types (bool, int, float, decimal) with their methods.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, type TypstBuiltin } from "./typstBuiltin";

const method = (name: string, doc: string, returns: string): TypstBuiltin => createFunctionBuiltin(name, doc, [], returns);
const bitwise = (name: string, doc: string) => createFunctionBuiltin(name, doc, [createPositionalParam("rhs", "int", "The right-hand operand.")], "int");
const endian = createNamedParam("endian", "str", "\"little\"", "The byte order, `\"big\"` or `\"little\"`.");

export const NUMBERS: readonly TypstBuiltin[] = [
  createTypeBuiltin("bool", "A value that is either `true` or `false`.", undefined, []),
  createTypeBuiltin("int", "A whole number; `int(..)` converts a value to an integer.", [
    createPositionalParam("value", "bool | int | float | decimal | str", "The value to convert."),
  ], [
    method("signum", "The sign of the integer: -1, 0 or 1.", "int"),
    method("bit-not", "The bitwise NOT of the integer.", "int"),
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
    method("is-nan", "Whether the float is not a number.", "bool"),
    method("is-infinite", "Whether the float is infinite.", "bool"),
    method("signum", "The sign of the float: -1.0 or 1.0, or NaN.", "float"),
    createFunctionBuiltin("from-bytes", "Reads a float from four or eight bytes.", [createPositionalParam("bytes", "bytes", "The bytes to read."), endian], "float"),
    createFunctionBuiltin("to-bytes", "Writes the float as bytes.", [endian, createNamedParam("size", "int", "8", "The number of bytes, 4 or 8.")], "bytes"),
  ]),
  createTypeBuiltin("decimal", "An exact decimal number, made with `decimal(\"1.5\")` to avoid floating-point error.", [
    createPositionalParam("value", "bool | int | float | str | decimal", "The value to convert; a string keeps every digit exactly."),
  ], []),
];
