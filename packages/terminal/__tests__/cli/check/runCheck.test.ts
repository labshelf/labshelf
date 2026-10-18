// Tests for `labshelf check`: exit codes on findings, the text and JSON output, and the missing-build and failure paths.
import { promises as fs } from "node:fs";
import * as path from "node:path";

import type { CheckFinding } from "@labshelf/core";

import type { Output } from "../../../src/cli";
import { runCheck, type ProjectChecker } from "../../../src/cli/check";
import { LibraryRoot } from "../../../src/library";
import { cleanupTempDirs, makeTempDir } from "../../fixtures/library";

afterEach(cleanupTempDirs);

const PROJECT = "id: thesis\nformat: latex\nmain: main.tex\ncheck:\n  anonymous: true\n";

const deAnonymised: CheckFinding[] = [
  { rule: "anonymity", severity: "error", message: "Author field names an author (Jane Doe).", location: { kind: "pdf" } },
  { rule: "fonts", severity: "warning", message: "Type 3 font cmss10.", location: { kind: "pdf", page: 2 } },
  { rule: "references", severity: "error", message: "Unresolved reference.", location: { kind: "source", file: "", line: 7 } },
];

async function setup(options: { built?: boolean } = {}) {
  const projectDir = await makeTempDir("labshelf-check-project-");
  await fs.writeFile(path.join(projectDir, "labshelf.yaml"), PROJECT);
  if (options.built !== false) { await fs.writeFile(path.join(projectDir, "main.pdf"), "%PDF-1.5"); }
  const out: string[] = [];
  const err: string[] = [];
  const errors: unknown[] = [];
  const io: Output = { out: (t) => out.push(t), err: (t) => err.push(t), columns: 100 };
  const ctx = {
    logger: { log: async () => undefined, error: async (_module: string, error: unknown) => { errors.push(error); } },
    paths: new LibraryRoot(await makeTempDir("labshelf-check-lib-")),
  };
  const calls: Array<{ folder: string; pdfPath: string; anonymous: boolean | undefined }> = [];
  const checker = (findings: CheckFinding[]): ProjectChecker => async (check) => {
    calls.push({ folder: check.folder, pdfPath: check.pdfPath, anonymous: check.settings?.anonymous });
    return findings.map((f) => (f.location.kind === "source" ? { ...f, location: { ...f.location, file: path.join(check.folder, "intro.tex") } } : f));
  };
  return { ctx, projectDir, io, out, err, errors, calls, checker };
}

describe("runCheck exit codes", () => {
  it("exits 1 on a de-anonymised PDF, checking the built PDF with the project's check settings", async () => {
    const { ctx, projectDir, io, calls, checker } = await setup();
    expect(await runCheck(ctx, [projectDir], {}, io, checker(deAnonymised))).toBe(1);
    expect(calls).toEqual([{ folder: projectDir, pdfPath: path.join(projectDir, "main.pdf"), anonymous: true }]);
  });

  it("exits 0 on a clean PDF and says so", async () => {
    const { ctx, projectDir, io, out, checker } = await setup();
    expect(await runCheck(ctx, [projectDir], {}, io, checker([]))).toBe(0);
    expect(out.join("\n")).toContain("No problems found");
  });

  it("exits 2 asking for a build when the PDF does not exist, without running the check", async () => {
    const { ctx, projectDir, io, err, calls, checker } = await setup({ built: false });
    expect(await runCheck(ctx, [projectDir], {}, io, checker([]))).toBe(2);
    expect(err.join("\n")).toContain("Run labshelf build first");
    expect(calls).toEqual([]);
  });

  it("logs and exits 1 when the check itself fails", async () => {
    const { ctx, projectDir, io, err, errors } = await setup();
    const failing: ProjectChecker = async () => { throw new Error("corrupt PDF"); };
    expect(await runCheck(ctx, [projectDir], {}, io, failing)).toBe(1);
    expect(err.join("\n")).toContain("corrupt PDF");
    expect(errors).toHaveLength(1);
  });
});

describe("runCheck output", () => {
  it("prints source findings as path:line: severity: message and PDF findings against the PDF", async () => {
    const { ctx, projectDir, io, out, checker } = await setup();
    await runCheck(ctx, [projectDir], {}, io, checker(deAnonymised));
    const rel = (file: string) => path.relative(process.cwd(), path.join(projectDir, file));
    expect(out).toEqual([
      `${rel("main.pdf")}: error: Author field names an author (Jane Doe).`,
      `${rel("main.pdf")}: page 2: warning: Type 3 font cmss10.`,
      `${rel("intro.tex")}:7: error: Unresolved reference.`,
    ]);
  });

  it("prints the findings array as JSON with --json, an empty array when clean", async () => {
    const dirty = await setup();
    await runCheck(dirty.ctx, [dirty.projectDir], { json: true }, dirty.io, dirty.checker(deAnonymised));
    const parsed = JSON.parse(dirty.out.join("\n")) as CheckFinding[];
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual(deAnonymised[0]);
    expect(parsed[2]!.location).toEqual({ kind: "source", file: path.join(dirty.projectDir, "intro.tex"), line: 7 });

    const clean = await setup();
    expect(await runCheck(clean.ctx, [clean.projectDir], { json: true }, clean.io, clean.checker([]))).toBe(0);
    expect(JSON.parse(clean.out.join("\n"))).toEqual([]);
  });
});
