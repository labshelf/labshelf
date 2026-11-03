/**
 * Tests readChartSource (plan charts, spec 3.3, D4/D5): what the chart view calls on mount for a block with src. A read file is
 * parsed into the table; no port, a null read or a rejected read give no table and 'Data file <src> not found'.
 */
import type { ChartTable } from "../../../src/qmd/chart/model";
import type { NoteFilesPort } from "../../../src/qmd/noteFiles";
import { readChartSource } from "../../../src/qmd/dom/chartView";

const SRC = "assets/a1b2c3d4.csv";
const TABLE: ChartTable = { cols: [{ name: "t", values: [1, 2, 3] }, { name: "v", values: [10, 20, 30] }] };
const NOT_FOUND = `Data file ${SRC} not found`;

function port(read: (path: string) => Promise<Uint8Array | null>): { port: NoteFilesPort; read: jest.Mock<Promise<Uint8Array | null>, [string]> } {
  const readMock = jest.fn(read);
  return { port: { read: readMock, write: async () => undefined, pickTextFile: async () => null }, read: readMock };
}

const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));

describe("readChartSource", () => {
  it("3.3b reads src through the port", async () => {
    const files = port(async () => bytesOf("t,v\n1,10\n2,20\n3,30\n"));
    await readChartSource(files.port, SRC);
    expect(files.read).toHaveBeenCalledWith(SRC);
  });

  it("A5 parses the CSV it read into the table, with nothing missing", async () => {
    const files = port(async () => bytesOf("t,v\n1,10\n2,20\n3,30\n"));
    await expect(readChartSource(files.port, SRC)).resolves.toEqual({ table: TABLE, missing: null });
  });

  it("A5 decodes the bytes as UTF-8", async () => {
    const files = port(async () => bytesOf("name,v\nµ,1\nβ,2\n"));
    const result = await readChartSource(files.port, SRC);
    expect(result.missing).toBeNull();
    expect(result.table?.cols.map((col) => col.name)).toEqual(["name", "v"]);
    expect(result.table?.cols[0]?.values).toEqual(["µ", "β"]);
  });

  it("A5 gives 'Data file <src> not found' and no table when the read returns null", async () => {
    const files = port(async () => null);
    await expect(readChartSource(files.port, SRC)).resolves.toEqual({ table: null, missing: NOT_FOUND });
  });

  it("A5 gives 'Data file <src> not found' and no table when there is no port", async () => {
    await expect(readChartSource(undefined, SRC)).resolves.toEqual({ table: null, missing: NOT_FOUND });
  });

  it("A5 gives 'Data file <src> not found' and no table when the read rejects", async () => {
    const files = port(async () => { throw new Error("host gone"); });
    await expect(readChartSource(files.port, SRC)).resolves.toEqual({ table: null, missing: NOT_FOUND });
  });
});
