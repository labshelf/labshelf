// The staging store keeps offered PDFs apart from the library and forgets the ones no offer names.
const rows = new Map<string, { id: string; bytes: Uint8Array; at: number }>();
jest.mock("idb", () => ({
  openDB: async () => ({
    put: async (_: string, row: { id: string; bytes: Uint8Array; at: number }) => { rows.set(row.id, row); },
    get: async (_: string, id: string) => rows.get(id),
    getAll: async () => [...rows.values()],
    delete: async (_: string, id: string) => { rows.delete(id); },
  }),
}));

import { removeStagedPdfsExcept, writeStagedPdf, readStagedPdf, removeStagedPdf } from "../../src/storage";

const PDF = new TextEncoder().encode("%PDF-1.7");

beforeEach(() => rows.clear());

it("hands back staged bytes until they are unstaged", async () => {
  await writeStagedPdf("a", PDF);
  expect(await readStagedPdf("a")).toBe(PDF);
  await removeStagedPdf("a");
  expect(await readStagedPdf("a")).toBeUndefined();
});

it("drops old bytes no offer names, and keeps young ones a match may still be using", async () => {
  await writeStagedPdf("kept", PDF);
  await writeStagedPdf("young", PDF);
  rows.set("orphan", { id: "orphan", bytes: PDF, at: Date.now() - 11 * 60_000 });
  await removeStagedPdfsExcept(["kept"]);
  expect([...rows.keys()].sort()).toEqual(["kept", "young"]);
});
