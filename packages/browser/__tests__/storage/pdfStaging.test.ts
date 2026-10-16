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

import { keepStagedPdfs, stagePdf, stagedPdf, unstagePdf } from "../../src/storage";

const PDF = new TextEncoder().encode("%PDF-1.7");

beforeEach(() => rows.clear());

it("hands back staged bytes until they are unstaged", async () => {
  await stagePdf("a", PDF);
  expect(await stagedPdf("a")).toBe(PDF);
  await unstagePdf("a");
  expect(await stagedPdf("a")).toBeUndefined();
});

it("drops old bytes no offer names, and keeps young ones a match may still be using", async () => {
  await stagePdf("kept", PDF);
  await stagePdf("young", PDF);
  rows.set("orphan", { id: "orphan", bytes: PDF, at: Date.now() - 11 * 60_000 });
  await keepStagedPdfs(["kept"]);
  expect([...rows.keys()].sort()).toEqual(["kept", "young"]);
});
