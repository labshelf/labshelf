// Tests for `labshelf install`: which listed papers it imports, under which key, and what it prints.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { DEFAULT_CONTACT_EMAIL, type DetectedIdentifier, type ResolvedMetadata } from "@labshelf/core";

import { UsageError, type Output } from "../../../src/cli";
import { runInstall } from "../../../src/cli/project";
import { cleanupTempDirs, makeTempDir } from "../../fixtures/library";
import { harness, pdfResponse } from "../../fixtures/paperService";

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
  const errors: string[] = [];
  const io: Output = { out: (t) => out.push(t), err: (t) => errors.push(t), columns: 100 };
  const ctx = { store: h.store, papers: { importDoi: (doi: string, key: string) => h.service.importDoi(doi, key) }, logger: { log: async () => undefined, error: async () => undefined } };
  return { h, projectDir, out, errors, run: (dir = projectDir, flags: Record<string, string | boolean> = {}) => runInstall(ctx, [dir], io, flags) };
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

  it("prints only the JSON summary to stdout with --json and still exits 1 on an unresolved key", async () => {
    const s = await setup(PROJECT);

    expect(await s.run(s.projectDir, { json: true })).toBe(1);

    expect(s.out).toHaveLength(1);
    expect(s.errors).toEqual([]);
    expect(JSON.parse(s.out[0]!)).toEqual({
      papers: [
        { key: "held2019", kind: "present", level: "info", resolved: true, text: "held2019: already in the library" },
        { key: "other2020", kind: "other-key", level: "warn", resolved: false, text: "other2020: in the library as other2018; cite it by that key or rename the paper" },
        { key: "lee20", kind: "import", level: "info", resolved: true, text: "lee20: added" },
        { key: "chen21", kind: "import", level: "warn", resolved: true, text: "chen21: added without a PDF" },
        { key: "ghost", kind: "no-doi", level: "warn", resolved: false, text: "ghost: no DOI listed, cannot install" },
      ],
      summary: { level: "warn", text: "2 added, 1 already in the library, 1 without a PDF, 2 not resolved" },
    });
  });

  it("prints a JSON summary with no papers for a project that lists none", async () => {
    const s = await setup("id: thesis\nformat: latex\n");
    expect(await s.run(s.projectDir, { json: true })).toBe(0);
    expect(JSON.parse(s.out[0]!)).toEqual({ papers: [], summary: { level: "info", text: "The project lists no papers" } });
  });

  it("runs headless: no TTY on stdin or stdout, nothing on stderr, no prompt", async () => {
    const s = await setup("id: thesis\nformat: latex\npapers:\n  - { key: held2019, doi: 10.1000/held }\n");
    const stdin = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const stdout = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
    try {
      expect(await s.run()).toBe(0);
    } finally {
      for (const [stream, descriptor] of [[process.stdin, stdin], [process.stdout, stdout]] as const) {
        if (descriptor) { Object.defineProperty(stream, "isTTY", descriptor); } else { delete (stream as { isTTY?: boolean }).isTTY; }
      }
    }
    expect(s.out).toEqual(["held2019: already in the library", "0 added, 1 already in the library"]);
    expect(s.errors).toEqual([]);
  });
});
