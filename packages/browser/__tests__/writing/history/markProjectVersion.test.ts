// Marking a version names the project's last built PDF and its sources, and the history keeps the milestone.
import type { ILogger } from "@labshelf/core";
import { historyRows, listVersions, posixPathOps } from "@labshelf/core";
import { confirmDialog, inputBox, toast } from "@labshelf/core/dom";
import { idbHistoryStorage } from "../../../src/storage/idb/idbHistoryStorage";
import { markProjectVersion } from "../../../src/writing/history";
import { clearFakeDb } from "../../support/fakeIdb";
import { memoryLibraryFs } from "../../support/memoryLibraryFs";

jest.mock("@labshelf/core/dom", () => ({ toast: jest.fn(), confirmDialog: jest.fn(), inputBox: jest.fn() }));
jest.mock("../../../src/storage/idb/db", () => ({ getDb: async () => require("../../support/fakeIdb").fakeDb }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
const project = { id: "thesis", folder: "proj" };
const pdf = new Uint8Array([37, 80, 68, 70]);

async function setup(lastFullPdf: () => Uint8Array | undefined) {
  const fs = memoryLibraryFs();
  await fs.writeText("proj/main.typ", "one");
  const mark = () => markProjectVersion({ fs, logger, lastFullPdf }, project);
  const versions = () => listVersions({ fs, paths: posixPathOps, logger }, "proj");
  return { fs, mark, versions };
}

beforeEach(() => { clearFakeDb(); jest.clearAllMocks(); });

describe("markProjectVersion", () => {
  it("asks for a build when the project has no PDF yet", async () => {
    const { mark, versions } = await setup(() => undefined);
    expect(await mark()).toBe(false);
    expect(toast).toHaveBeenCalledWith("Build the project once with LabShelf Helper to mark a version.");
    expect(inputBox).not.toHaveBeenCalled();
    expect(await versions()).toEqual([]);
  });

  it("saves the version with the built PDF, removes the temp PDF and records a version entry", async () => {
    const { fs, mark, versions } = await setup(() => pdf);
    (inputBox as jest.Mock).mockResolvedValue("Submitted");
    expect(await mark()).toBe(true);
    expect((await versions()).map((v) => v.name)).toEqual(["Submitted"]);
    expect(await fs.exists("proj/.labshelf/tmp-version.pdf")).toBe(false);
    const rows = await historyRows(idbHistoryStorage("thesis"), logger);
    expect(rows[0]).toMatchObject({ kind: "version", label: "Submitted" });
    expect(toast).toHaveBeenCalledWith("Marked version “Submitted”.", "ok");
  });

  it("changes nothing when the name is cancelled or a replace is declined", async () => {
    const { mark, versions } = await setup(() => pdf);
    (inputBox as jest.Mock).mockResolvedValue("Submitted");
    await mark();
    (confirmDialog as jest.Mock).mockResolvedValue(false);
    expect(await mark()).toBe(false);
    expect(confirmDialog).toHaveBeenCalledWith("Replace version “Submitted”?", expect.any(String), "Replace", true);
    (inputBox as jest.Mock).mockResolvedValue(undefined);
    expect(await mark()).toBe(false);
    expect(await versions()).toHaveLength(1);
  });
});
