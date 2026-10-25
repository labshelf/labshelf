// Catalogues Typst's data-loading category: reading files and decoding or encoding JSON, CSV, YAML, TOML, XML and CBOR.
import { fn, named, pos, type TypstBuiltin } from "./typstBuiltin";

const SOURCE = pos("source", "str | bytes", "A path to the file, or its raw bytes.");

const encoder = (format: string, value: string, pretty: boolean): TypstBuiltin =>
  fn("encode", `Encodes a value as ${format}.`, [
    pos("value", value, "The value to encode."),
    ...(pretty ? [named("pretty", "bool", "true", "Whether to indent and break lines for readability.")] : []),
  ], format === "CBOR" ? "bytes" : "str");

export const DATA_LOADING: readonly TypstBuiltin[] = [
  fn("read", "Reads a file as text or as raw bytes.", [
    pos("path", "str", "The path to the file."),
    named("encoding", "none | str", "\"utf8\"", "The text encoding; `none` returns the raw bytes."),
  ], "str | bytes"),
  fn("csv", "Reads CSV data into an array of rows.", [
    SOURCE,
    named("delimiter", "str", "\",\"", "The single-character column separator."),
    named("row-type", "type", "array", "Whether each row is an `array` or, keyed by the header row, a `dictionary`."),
  ], "array"),
  fn("json", "Reads JSON data into Typst values.", [SOURCE], "any", [encoder("JSON", "any", true)]),
  fn("yaml", "Reads YAML data into Typst values.", [SOURCE], "any", [encoder("YAML", "any", false)]),
  fn("toml", "Reads TOML data into a dictionary.", [SOURCE], "dictionary", [encoder("TOML", "dictionary", true)]),
  fn("xml", "Reads XML data into an array of element dictionaries and strings.", [SOURCE], "array"),
  fn("cbor", "Reads CBOR data into Typst values.", [pos("source", "str | bytes", "A path to the file, or its raw bytes.")], "any", [encoder("CBOR", "any", false)]),
];
