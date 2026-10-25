// Tests that only the published-version findings of the user's .bib files become preprint problems.
import * as vscode from "vscode";

import { BIBLIOGRAPHY_HEADER } from "@labshelf/core";
import { projectPreprints } from "../../../../src/writing/preview/buildRoot";
import type { ReadyProject } from "../../../../src/writing/buildRootDocument";
import { fakeDocument } from "../../../support/textDocument";
import { fakeLogger, readyEntry } from "../../../support/writingFixtures";

const workspace = vscode.workspace as unknown as Record<string, jest.Mock>;
const PREPRINT = "@article{vaswani2017,\n  title = {Attention},\n  doi = {10.1/x},\n  eprint = {1706.03762},\n  archivePrefix = {arXiv}\n}\n";
const project = readyEntry("/proj") as ReadyProject;
const lookup = jest.fn(async () => ({ doi: "10.5555/attn", record: { title: "Attention", journal: "NeurIPS", authors: ["Vaswani, A."], year: 2017 } }));

function listBibs(documents: Record<string, string>): void {
  const byPath = new Map(Object.entries(documents).map(([file, text]) => [file, fakeDocument(file, text)]));
  workspace.findFiles = jest.fn(async () => [...byPath.keys()].map((file) => vscode.Uri.file(file)));
  workspace.openTextDocument = jest.fn(async (uri: vscode.Uri) => byPath.get(uri.fsPath));
}

describe("projectPreprints", () => {
  it("reports the preprint of a user .bib with its file and line, and skips the generated file", async () => {
    listBibs({ "/proj/labshelf.bib": `${BIBLIOGRAPHY_HEADER}\n\n${PREPRINT}`, "/proj/refs.bib": `% refs\n\n${PREPRINT}` });
    const found = await projectPreprints({ logger: () => undefined, lookup: lookup as never })(project);
    expect(found).toEqual([expect.objectContaining({ key: "vaswani2017", file: "/proj/refs.bib", line: 3, message: expect.any(String) })]);
  });

  it("logs and answers nothing when the .bib files cannot be read", async () => {
    workspace.findFiles = jest.fn(async () => { throw new Error("denied"); });
    const logger = fakeLogger();
    expect(await projectPreprints({ logger: () => logger, lookup: lookup as never })(project)).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ projectFolder: "/proj" }));
  });
});
