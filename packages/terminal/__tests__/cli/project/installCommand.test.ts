// Tests for `labshelf install`: which listed papers it imports, under which key, and what it prints.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { DEFAULT_CONTACT_EMAIL, type DetectedIdentifier, type ResolvedMetadata } from "@labshelf/core";

import { UsageError, type Output } from "../../../src/cli";
import { runInstall } from "../../../src/cli/project";
import { cleanupTempDirs, makeTempDir } from "../../fixtures/library";
import { harness, pdfResponse, type Harness } from "../../fixtures/paperService";

afterEach(cleanupTempDirs);

const TITLES: Record<string, ResolvedMetadata> = {
  "10.1000/new": { title: "Brand New Result", authors: ["Ann Lee"], year: 2020, doi: "10.1000/new" },
  "10.1000/nopdf": { title: "Reference Only", authors: ["Bo Chen"], year: 2021, doi: "10.1000/nopdf" },
};

async function setup(yaml: string | undefined) {
  const h = await harness([
    { id: "held2019paper", title: "Held", meta: { citekey: "held2019", doi: "10.1000/held" } },
    { id: "other2018paper", title: "Other", meta: { citekey: "other2018", doi: "10.1000/other" } },
  ]);
  h.resolve.mockImplementation(async (id: DetectedIdentifier) => TITLES[id.value]);
  h.routes.set(
    `https://api.unpaywall.org/v2/${encodeURIComponent("10.1000/new")}?email=${encodeURIComponent(DEFAULT_CONTACT_EMAIL)}`,
    () => Response.json({ best_oa_location: { url_for_pdf: "https://repo.example.org/new.pdf" } }),
  );
  h.routes.set("https://repo.example.org/new.pdf", pdfResponse());
  const projectDir = await makeTempDir("labshelf-project-");
  if (yaml !== undefined) { await fs.writeFile(path.join(projectDir, "labshelf.yaml"), yaml); }
  const out: string[] = [];
  const io: Output = { out: (t) => out.push(t), err: () => undefined, columns: 100 };
  const ctx = { store: h.store, papers: { importDoi: (doi: string, key: string) => h.service.importDoi(doi, key) }, logger: { log: async () => undefined, error: async () => undefined } };
  return { h, projectDir, out, run: (dir = projectDir) => runInstall(ctx, [dir], io) };
}

const PROJECT = `id: thesis
format: latex
papers:
  - { key: held2019, doi: 10.1000/held }
  - { key: other2020, doi: 10.1000/other }
  - { key: lee20, doi: 10.1000/new }
  - { key: chen21, doi: 10.1000/nopdf }
  - { key: ghost }
`;

describe("labshelf install", () => {
  it("imports only the missing papers under the listed keys and prints a line per paper and a summary", async () => {
    const s = await setup(PROJECT);

    expect(await s.run()).toBe(1);

    expect(s.out).toEqual([
      "held2019: already in the library",
      "other2020: in the library as other2018; cite it by that key or rename the paper",
      "lee20: added",
      "chen21: added without a PDF",
      "ghost: no DOI listed, cannot install",
      "2 added, 1 already in the library, 1 without a PDF, 2 not resolved",
    ]);
    expect(s.h.store.paper("lee20")?.record).toMatchObject({ citeKey: "lee20", doi: "10.1000/new", hasPdf: true });
    expect(s.h.store.paper("chen21")?.record).toMatchObject({ citeKey: "chen21", hasPdf: false });
    expect(s.h.resolve).toHaveBeenCalledTimes(2);
  });

  it("exits 0 when every listed key resolves", async () => {
    const s = await setup("id: thesis\nformat: latex\npapers:\n  - { key: held2019, doi: 10.1000/held }\n");
    expect(await s.run()).toBe(0);
    expect(s.out).toEqual(["held2019: already in the library", "0 added, 1 already in the library"]);
  });

  it("fails with a usage error when the folder has no labshelf.yaml", async () => {
    const s = await setup(undefined);
    await expect(s.run()).rejects.toThrow(UsageError);
    await expect(s.run()).rejects.toThrow(/No labshelf\.yaml/);
  });

  it("fails with the reason when labshelf.yaml cannot be read", async () => {
    const s = await setup("id: thesis\nformat: docx\n");
    await expect(s.run()).rejects.toThrow(/format must be one of/);
  });
});
