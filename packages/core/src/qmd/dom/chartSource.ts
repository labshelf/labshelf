// The table of a chart block whose data lives in a CSV beside the note (plan charts, D4/D5): read through the note files port and
// parsed, or the note the chart view shows under its stored PNG when the file cannot be read.
import { parseCsv } from "../chart/csv.js";
import type { ChartTable } from "../chart/model.js";
import type { NoteFilesPort } from "../noteFiles.js";

/** The parsed table of `src`; no port, a missing file or a failed read give `missing` = "Data file <src> not found". */
export async function readChartSource(files: NoteFilesPort | undefined, src: string): Promise<{ table: ChartTable; missing: null } | { table: null; missing: string }> {
  const missing = { table: null, missing: `Data file ${src} not found` } as const;
  if (files === undefined) return missing;
  let bytes: Uint8Array | null;
  try {
    bytes = await files.read(src);
  } catch {
    return missing;
  }
  if (bytes === null) return missing;
  return { table: parseCsv(new TextDecoder().decode(bytes)).table, missing: null };
}
