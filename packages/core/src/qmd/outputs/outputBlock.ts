// Finds and writes the output blocks that hold a code cell's stored result inside an item body.
// CONTRACT: documents/contracts/qmd-items.md#outputs
import { attributeValue, formatDivOpener, isBalanced, lineContent, parseDivOpener, splitLines, topLevelDivs } from "../items/index.js";

export const OUTPUT_CLASS = "labshelf-output";

export interface OutputBlock {
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

export interface NewOutput {
  readonly cell: string;
  readonly source: string;
  readonly engine: string;
  readonly ran: string;
  readonly content: string;
}

/** Output blocks at the top level of `body`; a block without `cell` or `source` is text, not an output. */
export function findOutputs(body: string): OutputBlock[] {
  const lines = splitLines(body);
  const offsets = [0];
  for (const line of lines) { offsets.push(offsets.at(-1)! + line.length); }
  const outputs: OutputBlock[] = [];
  for (const { open, close } of topLevelDivs(lines)) {
    const attributes = parseDivOpener(lineContent(lines[open]!));
    if (!attributes?.classes.includes(OUTPUT_CLASS)) { continue; }
    const cell = attributeValue(attributes, "cell");
    const source = attributeValue(attributes, "source");
    if (!cell || !source) { continue; }
    const engine = attributeValue(attributes, "engine");
    const ran = attributeValue(attributes, "ran");
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
export function formatOutput(output: NewOutput, eol = "\n"): string {
  const opener = formatDivOpener({
    classes: [OUTPUT_CLASS],
    pairs: [["cell", output.cell], ["source", output.source], ["engine", output.engine], ["ran", output.ran]],
  });
  const content = output.content.replace(/\r\n|\n|\r/g, eol);
  const ended = content === "" || content.endsWith(eol) ? content : content + eol;
  if (!isBalanced(splitLines(ended))) { throw new Error(`Output of cell ${output.cell}: content opens or closes a div it does not close or open`); }
  return `${opener}${eol}${ended}:::${eol}`;
}
