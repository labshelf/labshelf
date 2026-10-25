// Catalogues Typst's data-loading category: reading files and decoding or encoding JSON, CSV, YAML, TOML, XML and CBOR.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, type TypstBuiltin } from "./typstBuiltin";

const SOURCE = createPositionalParam("source", "str | bytes", "A path to the file, or its raw bytes.");

const encoder = (format: string, value: string, pretty: boolean): TypstBuiltin =>
  createFunctionBuiltin("encode", `Encodes a value as ${format}.`, [
    createPositionalParam("value", value, "The value to encode."),
    ...(pretty ? [createNamedParam("pretty", "bool", "true", "Whether to indent and break lines for readability.")] : []),
  ], format === "CBOR" ? "bytes" : "str");

export const DATA_LOADING: readonly TypstBuiltin[] = [
  createFunctionBuiltin("read", "Reads a file as text or as raw bytes.", [
    createPositionalParam("path", "str", "The path to the file."),
    createNamedParam("encoding", "none | str", "\"utf8\"", "The text encoding; `none` returns the raw bytes."),
  ], "str | bytes"),
  createFunctionBuiltin("csv", "Reads CSV data into an array of rows.", [
    SOURCE,
    createNamedParam("delimiter", "str", "\",\"", "The single-character column separator."),
    createNamedParam("row-type", "type", "array", "Whether each row is an `array` or, keyed by the header row, a `dictionary`."),
  ], "array"),
  createFunctionBuiltin("json", "Reads JSON data into Typst values.", [SOURCE], "any", [encoder("JSON", "any", true)]),
  createFunctionBuiltin("yaml", "Reads YAML data into Typst values.", [SOURCE], "any", [encoder("YAML", "any", false)]),
  createFunctionBuiltin("toml", "Reads TOML data into a dictionary.", [SOURCE], "dictionary", [encoder("TOML", "dictionary", true)]),
  createFunctionBuiltin("xml", "Reads XML data into an array of element dictionaries and strings.", [SOURCE], "array"),
  createFunctionBuiltin("cbor", "Reads CBOR data into Typst values.", [createPositionalParam("source", "str | bytes", "A path to the file, or its raw bytes.")], "any", [encoder("CBOR", "any", false)]),
];
