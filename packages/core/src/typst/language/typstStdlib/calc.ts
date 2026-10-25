// Catalogues Typst's `calc` module of numeric functions and constants.
import { createFunctionBuiltin, createModuleBuiltin, createNamedParam, createPositionalParam, createConstantBuiltin, createVariadicParam, type TypstBuiltin } from "./typstBuiltin";

const NUM = "int | float";
const DEC = "int | float | decimal";
const unary = (name: string, doc: string, type: string, returns: string, param = "value"): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam(param, type, "The input value.")], returns);
const binary = (name: string, doc: string, type: string, a: string, b: string, returns: string): TypstBuiltin =>
  createFunctionBuiltin(name, doc, [createPositionalParam(a, type, "The first operand."), createPositionalParam(b, type, "The second operand.")], returns);

export const CALC = createModuleBuiltin("calc", "Calculations and processing of numeric values.", [
  unary("abs", "The absolute value of a numeric value.", "int | float | length | angle | ratio | fraction | decimal", "any"),
  createFunctionBuiltin("pow", "Raises a value to some exponent.", [
    createPositionalParam("base", DEC, "The base of the power."), createPositionalParam("exponent", NUM, "The exponent of the power."),
  ], "int | float | decimal"),
  unary("exp", "Raises e to some exponent.", NUM, "float", "exponent"),
  unary("sqrt", "The square root of a number.", NUM, "float"),
  createFunctionBuiltin("root", "The real nth root of a number.", [
    createPositionalParam("radicand", "float", "The number whose root to take."), createPositionalParam("index", "int", "Which root to take."),
  ], "float"),
  unary("sin", "The sine of an angle; plain numbers are radians.", "int | float | angle", "float", "angle"),
  unary("cos", "The cosine of an angle; plain numbers are radians.", "int | float | angle", "float", "angle"),
  unary("tan", "The tangent of an angle; plain numbers are radians.", "int | float | angle", "float", "angle"),
  unary("asin", "The arcsine of a number between -1 and 1.", NUM, "angle"),
  unary("acos", "The arccosine of a number between -1 and 1.", NUM, "angle"),
  unary("atan", "The arctangent of a number.", NUM, "angle"),
  binary("atan2", "The four-quadrant arctangent of a coordinate pair.", NUM, "x", "y", "angle"),
  unary("sinh", "The hyperbolic sine of a hyperbolic angle.", NUM, "float"),
  unary("cosh", "The hyperbolic cosine of a hyperbolic angle.", NUM, "float"),
  unary("tanh", "The hyperbolic tangent of a hyperbolic angle.", NUM, "float"),
  createFunctionBuiltin("log", "The logarithm of a number, in base 10 unless `base` says otherwise.", [
    createPositionalParam("value", NUM, "The number whose logarithm to take."), createNamedParam("base", "float", "10.0", "The base of the logarithm."),
  ], "float"),
  unary("ln", "The natural logarithm of a number.", NUM, "float"),
  unary("fact", "The factorial of a number.", "int", "int", "number"),
  binary("perm", "The number of permutations of `numbers` items out of `base`.", "int", "base", "numbers", "int"),
  binary("binom", "The binomial coefficient of n over k.", "int", "n", "k", "int"),
  binary("gcd", "The greatest common divisor of two integers.", "int", "a", "b", "int"),
  binary("lcm", "The least common multiple of two integers.", "int", "a", "b", "int"),
  unary("floor", "Rounds a number down to the nearest integer.", DEC, "int | decimal"),
  unary("ceil", "Rounds a number up to the nearest integer.", DEC, "int | decimal"),
  unary("trunc", "The integer part of a number.", DEC, "int | decimal"),
  unary("fract", "The fractional part of a number.", DEC, "int | float | decimal"),
  createFunctionBuiltin("round", "Rounds a number to the nearest integer, or to `digits` decimal places.", [
    createPositionalParam("value", DEC, "The number to round."), createNamedParam("digits", "int", "0", "How many decimal places to keep."),
  ], "int | float | decimal"),
  createFunctionBuiltin("clamp", "Clamps a number between a minimum and a maximum.", [
    createPositionalParam("value", DEC, "The number to clamp."), createPositionalParam("min", DEC, "The inclusive minimum."), createPositionalParam("max", DEC, "The inclusive maximum."),
  ], "int | float | decimal"),
  createFunctionBuiltin("min", "The smallest of a sequence of values.", [createVariadicParam("values", "any", "The values to compare.")], "any"),
  createFunctionBuiltin("max", "The largest of a sequence of values.", [createVariadicParam("values", "any", "The values to compare.")], "any"),
  unary("even", "Whether an integer is even.", "int", "bool"),
  unary("odd", "Whether an integer is odd.", "int", "bool"),
  binary("rem", "The remainder of a division, with the sign of the dividend.", DEC, "dividend", "divisor", "int | float | decimal"),
  binary("div-euclid", "The quotient of a Euclidean division.", DEC, "dividend", "divisor", "int | float | decimal"),
  binary("rem-euclid", "The non-negative remainder of a Euclidean division.", DEC, "dividend", "divisor", "int | float | decimal"),
  binary("quo", "The quotient of a division, rounded down.", DEC, "dividend", "divisor", "int | float | decimal"),
  createFunctionBuiltin("norm", "The p-norm of a sequence of numbers.", [
    createVariadicParam("values", "float", "The numbers whose norm to take."),
    createNamedParam("p", "float", "2.0", "The p of the p-norm; `float.inf` gives the maximum norm."),
  ], "float"),
  createConstantBuiltin("pi", "The constant π."),
  createConstantBuiltin("tau", "The constant τ, twice π."),
  createConstantBuiltin("e", "Euler's number."),
  createConstantBuiltin("inf", "Positive infinity."),
]);
