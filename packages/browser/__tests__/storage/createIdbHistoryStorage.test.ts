import { createIdbHistoryStorage } from "../../src/storage/createIdbHistoryStorage";
import { clearFakeDb, fakeRows } from "../support/fakeIdb";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("../../src/storage/idbDatabase", () => ({ openDb: async () => require("../support/fakeIdb").fakeDb }));

beforeEach(() => clearFakeDb());

describe("createIdbHistoryStorage", () => {
  it("reads an empty log before anything was appended", async () => {
    expect(await createIdbHistoryStorage("p").readLog()).toBe("");
  });

  it("appends lines to the log of its own project only", async () => {
    const a = createIdbHistoryStorage("a");
    await a.appendLog("one\n");
    await a.appendLog("two\n");
    await createIdbHistoryStorage("b").appendLog("other\n");
    expect(await a.readLog()).toBe("one\ntwo\n");
    expect(fakeRows.historyLog.get("b")).toEqual({ projectId: "b", text: "other\n" });
  });

  it("stores objects by hash and shares them between projects", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await createIdbHistoryStorage("a").writeObject("h1", bytes);
    expect(await createIdbHistoryStorage("b").hasObject("h1")).toBe(true);
    expect(await createIdbHistoryStorage("b").hasObject("h2")).toBe(false);
    expect(await createIdbHistoryStorage("b").readObject("h1")).toEqual(bytes);
  });

  it("fails reading an object that is missing", async () => {
    await expect(createIdbHistoryStorage("a").readObject("nope")).rejects.toThrow("nope");
  });
});
