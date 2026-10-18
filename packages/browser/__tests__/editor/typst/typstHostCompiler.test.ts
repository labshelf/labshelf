// Pins the editor page's Typst compiles for the web build: project-relative paths in and out, one session, the page's project only.
import type { TypstCompileRequest, TypstCompileResult } from "@labshelf/core/typst";
import { createTypstHostCompiler } from "../../../src/editor/typst/typstHostCompiler";

function setup(result: TypstCompileResult) {
  const compile = jest.fn(async (_request: TypstCompileRequest) => result);
  const open = jest.fn(async () => ({ compile }));
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
  return { compile, open, compileTypst: createTypstHostCompiler({ projectId: "cv", open, logger }) };
}

describe("createTypstHostCompiler", () => {
  it("compiles the main file with the editor text shadowing the snapshot, and maps problems back to project paths", async () => {
    const { compile, compileTypst } = setup({
      pdf: new Uint8Array([37]),
      diagnostics: [{ package: "", path: "/project/parts/a.typ", severity: "warning", range: "4:0-4:3", message: "unused" }],
      citations: { cites: [{ key: "k", at: { page: 1, x: 0, y: 0 } }] },
    });
    const outcome = await compileTypst({ projectId: "cv", main: "main.typ", sources: [{ path: "parts/a.typ", text: "x" }] });
    expect(compile).toHaveBeenCalledWith({ root: "/project", main: "/project/main.typ", sources: new Map([["/project/parts/a.typ", "x"]]) });
    expect(outcome).toEqual({
      status: "succeeded", pdf: new Uint8Array([37]), cites: [{ key: "k", at: { page: 1, x: 0, y: 0 } }],
      problems: [{ severity: "warning", message: "unused", file: "parts/a.typ", line: 5 }],
    });
  });

  it("fails without a PDF, says why when the compiler gave no error, and opens the session once", async () => {
    const { open, compileTypst } = setup({ diagnostics: [] });
    const request = { projectId: "cv", main: "main.typ", sources: [] };
    expect(await compileTypst(request)).toEqual({ status: "failed", problems: [{ severity: "error", message: "Typst produced no PDF and reported no error.", file: "main.typ" }] });
    await compileTypst(request);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("refuses a project other than the page's", async () => {
    const { compileTypst } = setup({ diagnostics: [] });
    await expect(compileTypst({ projectId: "thesis", main: "main.typ", sources: [] })).rejects.toThrow(/thesis/);
  });
});
