// Tests that Install Project Papers imports only the listed papers the library lacks, under the listed keys.
import * as path from "node:path";
import * as vscode from "vscode";

import type { ImportOutcome, PaperRecord } from "@labshelf/core";
import { queueTextLayersOfAdded } from "../../src/command/index";
import { registerInstallCommand, type InstallServices } from "../../src/writing/index";
import { commandHandler, fakeHost, fakeLogger, readyEntry } from "../support/writingFixtures";

jest.mock("../../src/command/index", () => ({ ...jest.requireActual("../../src/command/index"), queueTextLayersOfAdded: jest.fn() }));

const window = vscode.window as unknown as Record<string, jest.Mock>;
const paper = (id: string, over: Partial<PaperRecord> = {}): PaperRecord => ({ id, title: id, path: id, citeKey: id, status: "unread", ...over }) as PaperRecord;
const added = (citeKey: string, hasPdf = true): ImportOutcome => ({ status: "added", record: paper(citeKey, { hasPdf }), needsReview: false, input: "x" });

beforeEach(() => jest.clearAllMocks());

function setup(library: PaperRecord[], importFromNetwork: jest.Mock) {
  const logger = fakeLogger();
  const services: InstallServices = {
    importer: { importFromNetwork },
    textLayers: {} as never,
    paperService: { listPapers: async () => library },
    logger,
  };
  registerInstallCommand({ context: { subscriptions: [] } as never, host: fakeHost(logger), projects: { list: () => [], paths: path }, services: () => services });
  return services;
}

const project = readyEntry("/code/thesis", {
  settings: {
    id: "thesis", format: "latex",
    papers: [{ key: "held", doi: "10.1000/held" }, { key: "lee20", doi: "10.1000/lee" }, { key: "chen21", doi: "10.1000/chen" }, { key: "ghost" }],
  },
});

describe("labshelf.installProjectPapers", () => {
  it("imports only the missing papers by DOI under the listed key and queues the text layers of the added ones", async () => {
    const importFromNetwork = jest.fn(async (doi: string) => (doi.endsWith("lee") ? added("lee20") : added("chen21", false)));
    const services = setup([paper("held")], importFromNetwork);

    await commandHandler("labshelf.installProjectPapers")(project);

    expect(importFromNetwork.mock.calls).toEqual([
      ["10.1000/lee", undefined, { citeKey: "lee20" }],
      ["10.1000/chen", undefined, { citeKey: "chen21" }],
    ]);
    expect(queueTextLayersOfAdded).toHaveBeenCalledWith(services, [added("lee20"), added("chen21", false)]);
    expect(window["showWarningMessage"]).toHaveBeenCalledWith(expect.stringContaining("2 added, 1 already in the library, 1 without a PDF, 1 not resolved"));
    expect(window["showWarningMessage"]).toHaveBeenCalledWith(expect.stringContaining("ghost: no DOI listed"));
  });

  it("reports a failed import and says everything is installed when nothing is missing", async () => {
    setup([paper("held")], jest.fn(async (): Promise<ImportOutcome> => ({ status: "failed", error: "Could not find DOI", input: "x" })));
    await commandHandler("labshelf.installProjectPapers")(project);
    expect(window["showWarningMessage"]).toHaveBeenCalledWith(expect.stringContaining("lee20: failed: Could not find DOI"));

    jest.clearAllMocks();
    const importFromNetwork = jest.fn();
    setup([paper("held")], importFromNetwork);
    await commandHandler("labshelf.installProjectPapers")(readyEntry("/code/t", { settings: { id: "t", format: "latex", papers: [{ key: "held" }] } }));
    expect(importFromNetwork).not.toHaveBeenCalled();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith("LabShelf: 0 added, 1 already in the library");
  });

  it("asks for a project when none is chosen or active", async () => {
    const importFromNetwork = jest.fn();
    setup([], importFromNetwork);
    await commandHandler("labshelf.installProjectPapers")(undefined);
    expect(importFromNetwork).not.toHaveBeenCalled();
    expect(window["showInformationMessage"]).toHaveBeenCalledWith(expect.stringContaining("Open a file of a writing project"));
  });
});
