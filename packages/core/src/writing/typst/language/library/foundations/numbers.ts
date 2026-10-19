// Catalogues Typst's boolean and numeric types (bool, int, float, decimal) with their methods.
import { fn, named, pos, ty, type TypstBuiltin } from "../typstBuiltin";

const method = (name: string, doc: string, returns: string): TypstBuiltin => fn(name, doc, [], returns);
const bitwise = (name: string, doc: string) => fn(name, doc, [pos("rhs", "int", "The right-hand operand.")], "int");
const endian = named("endian", "str", "\"little\"", "The byte order, `\"big\"` or `\"little\"`.");

export const NUMBERS: readonly TypstBuiltin[] = [
  ty("bool", "A value that is either `true` or `false`.", undefined, []),
  ty("int", "A whole number; `int(..)` converts a value to an integer.", [
    pos("value", "bool | int | float | decimal | str", "The value to convert."),
  ], [
    method("signum", "The sign of the integer: -1, 0 or 1.", "int"),
    method("bit-not", "The bitwise NOT of the integer.", "int"),
    bitwise("bit-and", "The bitwise AND of two integers."),
    bitwise("bit-or", "The bitwise OR of two integers."),
    bitwise("bit-xor", "The bitwise XOR of two integers."),
    fn("bit-lshift", "Shifts the bits to the left.", [pos("shift", "int", "How many bits to shift.")], "int"),
    fn("bit-rshift", "Shifts the bits to the right.", [
      pos("shift", "int", "How many bits to shift."),
      named("logical", "bool", "false", "Whether to fill with zeros instead of the sign bit."),
    ], "int"),
    fn("from-bytes", "Reads an integer from bytes.", [
      pos("bytes", "bytes", "The bytes to read, at most eight."), endian,
      named("signed", "bool", "true", "Whether the bytes hold a signed integer."),
    ], "int"),
    fn("to-bytes", "Writes the integer as bytes.", [endian, named("size", "int", "8", "The number of bytes.")], "bytes"),
  ]),
  ty("float", "A 64-bit floating-point number; `float(..)` converts a value to a float.", [
    pos("value", "bool | int | float | decimal | ratio | str", "The value to convert."),
  ], [
    method("is-nan", "Whether the float is not a number.", "bool"),
    method("is-infinite", "Whether the float is infinite.", "bool"),
    method("signum", "The sign of the float: -1.0 or 1.0, or NaN.", "float"),
    fn("from-bytes", "Reads a float from four or eight bytes.", [pos("bytes", "bytes", "The bytes to read."), endian], "float"),
    fn("to-bytes", "Writes the float as bytes.", [endian, named("size", "int", "8", "The number of bytes, 4 or 8.")], "bytes"),
  ]),
  ty("decimal", "An exact decimal number, made with `decimal(\"1.5\")` to avoid floating-point error.", [
    pos("value", "bool | int | float | str | decimal", "The value to convert; a string keeps every digit exactly."),
  ], []),
];
