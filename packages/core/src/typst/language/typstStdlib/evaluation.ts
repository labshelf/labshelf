// Catalogues Typst's evaluation and system functions: type, repr, panic, assert, eval, plugin and `sys`.
import { createFunctionBuiltin, createModuleBuiltin, createNamedParam, createPositionalParam, createTypeBuiltin, createConstantBuiltin, createVariadicParam, type TypstBuiltin } from "./typstBuiltin";

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
