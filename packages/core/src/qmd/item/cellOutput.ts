// Finds and writes the output blocks that hold a code cell's stored result inside an item body, and hashes the code they date.
// CONTRACT: documents/contracts/qmd-items.md#outputs
import { deriveTextSha256Hex } from "../../hash/index.js";
import { readAttribute, formatDivOpener, isBalanced, extractLineContent, parseDivOpener, splitLines, findTopLevelDivs } from "./itemFile.js";

export const OUTPUT_CLASS = "labshelf-output";

export interface CellOutputBlock {
  /** The label of the cell the result belongs to. */
  readonly cell: string;
  readonly source: string;
  readonly engine?: string;
  readonly ran?: string;
  /** The result's Markdown, the bytes between the block's fences. */
  readonly content: string;
  /** UTF-16 offsets of the whole block in the body, from its opening line to after its closing line. */
  readonly start: number;
  readonly end: number;
}

export interface CreateOutputInput {
  readonly cell: string;
  readonly source: string;
  readonly engine: string;
  readonly ran: string;
  readonly content: string;
  /** Written as the opener's last attribute; an ok result has none. */
  readonly status?: "error";
}

/** Output blocks at the top level of `body`; a block without `cell` or `source` is text, not an output. */
export function findOutputs(body: string): CellOutputBlock[] {
  const lines = splitLines(body);
  const offsets = [0];
  for (const line of lines) { offsets.push(offsets.at(-1)! + line.length); }
  const outputs: CellOutputBlock[] = [];
  for (const { open, close } of findTopLevelDivs(lines)) {
    const attributes = parseDivOpener(extractLineContent(lines[open]!));
    if (!attributes?.classes.includes(OUTPUT_CLASS)) { continue; }
    const cell = readAttribute(attributes, "cell");
    const source = readAttribute(attributes, "source");
    if (!cell || !source) { continue; }
    const engine = readAttribute(attributes, "engine");
    const ran = readAttribute(attributes, "ran");
    outputs.push({
      cell,
      source,
      ...(engine === undefined ? {} : { engine }),
      ...(ran === undefined ? {} : { ran }),
      content: lines.slice(open + 1, close).join(""),
      start: offsets[open]!,
      end: offsets[close + 1]!,
    });
  }
  return outputs;
}

/** Writes a whole output block, ending with `eol`. Throws when the content would end the block early. */
export function formatOutput(output: CreateOutputInput, eol = "\n"): string {
  const opener = formatDivOpener({
    classes: [OUTPUT_CLASS],
    pairs: [
      ["cell", output.cell], ["source", output.source], ["engine", output.engine], ["ran", output.ran],
      ...(output.status === undefined ? [] : [["status", output.status] as [string, string]]),
    ],
  });
  const content = output.content.replace(/\r\n|\n|\r/g, eol);
  const ended = content === "" || content.endsWith(eol) ? content : content + eol;
  if (!isBalanced(splitLines(ended))) { throw new Error(`Output of cell ${output.cell}: content opens or closes a div it does not close or open`); }
  return `${opener}${eol}${ended}:::${eol}`;
}

const SOURCE_LENGTH = 12;

/** `code` is the text between the cell's fences; `#|` option lines and line endings do not change the hash. */
export async function deriveCodeHash(code: string): Promise<string> {
  const lines = code.split(/\r\n|\n|\r/).filter((line) => !line.startsWith("#|"));
  const normalized = lines.join("\n").replace(/\n+$/, "");
  return (await deriveTextSha256Hex(normalized)).slice(0, SOURCE_LENGTH);
}
