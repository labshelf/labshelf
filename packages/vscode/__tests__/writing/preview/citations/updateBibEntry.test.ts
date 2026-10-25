// Tests that the published-version fix edits only the user's .bib, and that the venue comes from the lookup.
import * as vscode from "vscode";

import { BIBLIOGRAPHY_HEADER } from "@labshelf/core";
import { readPublishedVenue, updateBibEntry } from "../../../../src/writing/preview/citations/updateBibEntry";
import { fakeDocument } from "../../../support/textDocument";
import { fakeLogger } from "../../../support/writingFixtures";

const workspace = vscode.workspace as unknown as Record<string, jest.Mock>;
const applyEdit = vscode.workspace.applyEdit as jest.Mock;
const PREPRINT = "@article{vaswani2017,\n  title = {Attention},\n  eprint = {1706.03762},\n  archivePrefix = {arXiv}\n}\n";
const USER_BIB = fakeDocument("/proj/refs.bib", `${PREPRINT}`);
const GENERATED_BIB = fakeDocument("/proj/labshelf.bib", `${BIBLIOGRAPHY_HEADER}\n\n${PREPRINT}`);

function setup() {
  const documents = new Map([["/proj/labshelf.bib", GENERATED_BIB], ["/proj/refs.bib", USER_BIB]]);
  workspace.findFiles = jest.fn(async () => [...documents.keys()].map((path) => vscode.Uri.file(path)));
  workspace.openTextDocument = jest.fn(async (uri: vscode.Uri) => documents.get(uri.fsPath));
  applyEdit.mockClear();
  const publishedLookup = jest.fn(async () => ({
    doi: "10.5555/attn", record: { title: "Attention", journal: "NeurIPS", authors: ["Vaswani, A."], year: 2017 },
  }));
  const logger = fakeLogger();
  return { deps: { projectFolder: "/proj", logger, publishedLookup: publishedLookup as never }, publishedLookup, logger };
}

describe("updateBibEntry", () => {
  it("edits the user's .bib with the published fields and leaves the generated one alone", async () => {
    const { deps } = setup();
    await updateBibEntry(deps, "vaswani2017");
    expect(applyEdit).toHaveBeenCalledTimes(1);
    const edit = applyEdit.mock.calls[0]![0] as { replacements: { uri: vscode.Uri; text: string }[] };
    expect(edit.replacements).toHaveLength(1);
    expect(edit.replacements[0]!.uri.fsPath).toBe("/proj/refs.bib");
    expect(edit.replacements[0]!.text).toContain("NeurIPS");
    expect(edit.replacements[0]!.text).toContain("10.5555/attn");
  });

  it("shows an error and logs it when the key has no published version", async () => {
    const { deps, publishedLookup, logger } = setup();
    publishedLookup.mockResolvedValue(undefined as never);
    await updateBibEntry(deps, "vaswani2017");
    expect(applyEdit).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith("writing/preview", expect.any(Error), expect.objectContaining({ key: "vaswani2017" }));
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});

describe("readPublishedVenue", () => {
  it("returns the journal of the published version", async () => {
    const { deps } = setup();
    expect(await readPublishedVenue(deps, "vaswani2017")).toBe("NeurIPS");
  });

  it("returns undefined for a key that is not in the user's .bib", async () => {
    const { deps } = setup();
    expect(await readPublishedVenue(deps, "missing")).toBeUndefined();
  });
});
