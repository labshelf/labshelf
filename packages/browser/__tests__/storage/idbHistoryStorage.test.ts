import { idbHistoryStorage } from "../../src/storage/idbHistoryStorage";
import { clearFakeDb, fakeRows } from "../support/fakeIdb";

jest.mock("webextension-polyfill", () => ({}));
jest.mock("../../src/storage/idbDatabase", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

beforeEach(() => clearFakeDb());

describe("idbHistoryStorage", () => {
  it("reads an empty log before anything was appended", async () => {
    expect(await idbHistoryStorage("p").readLog()).toBe("");
  });

  it("appends lines to the log of its own project only", async () => {
    const a = idbHistoryStorage("a");
    await a.appendLog("one\n");
    await a.appendLog("two\n");
    await idbHistoryStorage("b").appendLog("other\n");
    expect(await a.readLog()).toBe("one\ntwo\n");
    expect(fakeRows.historyLog.get("b")).toEqual({ projectId: "b", text: "other\n" });
  });

  it("stores objects by hash and shares them between projects", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await idbHistoryStorage("a").writeObject("h1", bytes);
    expect(await idbHistoryStorage("b").hasObject("h1")).toBe(true);
    expect(await idbHistoryStorage("b").hasObject("h2")).toBe(false);
    expect(await idbHistoryStorage("b").readObject("h1")).toEqual(bytes);
  });

  it("fails reading an object that is missing", async () => {
    await expect(idbHistoryStorage("a").readObject("nope")).rejects.toThrow("nope");
  });
});
