// Catalogues Typst's evaluation and system functions: type, repr, panic, assert, eval, plugin and `sys`.
import { fn, mod, named, pos, ty, val, variadic, type TypstBuiltin } from "./typstBuiltin";

const message = named("message", "str", undefined, "The error message if the assertion fails.");
const comparison = (name: string, doc: string): TypstBuiltin =>
  fn(name, doc, [pos("left", "any", "The first value."), pos("right", "any", "The second value."), message], "none");

export const EVALUATION: readonly TypstBuiltin[] = [
  ty("module", "A collection of definitions, such as `calc` or a file loaded with `import`.", undefined, []),
  ty("type", "The type of a value; `type(x)` returns it, and types compare with `==`.", [
    pos("value", "any", "The value whose type to return."),
  ], []),
  fn("repr", "The debug representation of a value as a string.", [pos("value", "any", "The value to represent.")], "str"),
  fn("panic", "Fails compilation with an error showing the given values.", [
    variadic("values", "any", "The values to show in the error."),
  ], "none"),
  fn("assert", "Fails compilation if a condition is not `true`.", [
    pos("condition", "bool", "The condition that must hold."), message,
  ], "none", [
    comparison("eq", "Fails compilation if two values are not equal."),
    comparison("ne", "Fails compilation if two values are equal."),
  ]),
  fn("eval", "Evaluates a string as Typst code or markup.", [
    pos("source", "str", "The source to evaluate."),
    named("mode", "str", "\"code\"", "How to parse the source: `\"code\"`, `\"markup\"` or `\"math\"`."),
    named("scope", "dictionary", "(:)", "Variables the source can use."),
  ], "any"),
  fn("plugin", "Loads a WebAssembly plugin, whose exported functions become callable.", [
    pos("source", "str | bytes", "The path to the `.wasm` file, or its bytes."),
  ], "module"),
  mod("sys", "Information about the system Typst runs on.", [
    val("version", "The version of the Typst compiler, as a `version`."),
    val("inputs", "The string inputs given with `--input key=value`, as a dictionary."),
  ]),
];
