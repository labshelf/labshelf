// A saved edit becomes a history entry; a failure is logged and never reaches the editor.
import type { ILogger } from "@labshelf/core";
import { readHistoryRows } from "@labshelf/core";
import { createIdbHistoryStorage } from "../../../src/storage/createIdbHistoryStorage";
import { addProjectUpdateEvent } from "../../../src/writing/history";
import { clearFakeDb } from "../../support/fakeIdb";
import { memoryLibraryFs } from "../../support/memoryLibraryFs";

jest.mock("../../../src/storage/idbDatabase", () => ({ openDb: async () => require("../../support/fakeIdb").fakeDb }));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

beforeEach(() => { clearFakeDb(); jest.clearAllMocks(); });

describe("addProjectUpdateEvent", () => {
  it("records the project's files as an edit entry", async () => {
    const fs = memoryLibraryFs();
    await fs.writeText("proj/main.typ", "one");
    await addProjectUpdateEvent({ fs, logger }, { id: "thesis", folder: "proj" });
    const rows = await readHistoryRows(createIdbHistoryStorage("thesis"), logger);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "edit", changes: [{ path: "main.typ" }] });
  });

  it("logs and resolves when the folder cannot be read", async () => {
    const fs = memoryLibraryFs();
    fs.listDir = async () => { throw new Error("disk gone"); };
    await expect(addProjectUpdateEvent({ fs, logger }, { id: "thesis", folder: "proj" })).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
