// The chart editor's commit step (plan charts, D4/D5): places the table inline or in assets/<id>.csv and writes the CSV through
// the note files port before the block is handed to the note, so a block never points at a file that was not written.
import { placeTable } from "../../chart/table.js";
import type { ChartModel, ChartTable } from "../../chart/model.js";
import type { NoteFilesPort } from "../../noteFiles.js";

/** The model to write with `table` placed; a large table is written to its CSV first, and stays inline without `files`. A failed write gives its message and no model. */
export async function commitChart(model: ChartModel, table: ChartTable, files: NoteFilesPort | undefined): Promise<{ model: ChartModel; error: null } | { model: null; error: string }> {
  if (files === undefined) {
    const { src: _src, ...rest } = model;
    return { model: { ...rest, data: table }, error: null };
  }
  const placed = placeTable(model, table);
  if (placed.csv === null) return { model: placed.model, error: null };
  try {
    await files.write(placed.csv.path, new TextEncoder().encode(placed.csv.text));
  } catch (error) {
    return { model: null, error: error instanceof Error ? error.message : String(error) };
  }
  return { model: placed.model, error: null };
}
