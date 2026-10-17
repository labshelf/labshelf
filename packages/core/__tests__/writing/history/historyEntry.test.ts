// Tests reading history log lines, which must never point outside the project folder.
import { parseHistoryLine, serializeHistoryLine, type HistoryEntry } from "../../../src/writing/history/index";

const HASH = "a".repeat(64);
const entry: HistoryEntry = { id: "1-x", at: "2026-10-17T10:00:00.000Z", kind: "edit", files: { "main.tex": HASH } };

describe("parseHistoryLine", () => {
  it("reads back a serialized entry", () => {
    expect(parseHistoryLine(serializeHistoryLine(entry))).toEqual(entry);
  });

  it.each(["../escape.tex", "/abs.tex", "a//b.tex", "C:/x.tex", "./main.tex"])("rejects the path %s", (file) => {
    expect(parseHistoryLine(JSON.stringify({ ...entry, files: { [file]: HASH } }))).toBeUndefined();
  });

  it("rejects an unknown kind, a bad hash or a bad timestamp", () => {
    expect(parseHistoryLine(JSON.stringify({ ...entry, kind: "other" }))).toBeUndefined();
    expect(parseHistoryLine(JSON.stringify({ ...entry, files: { "main.tex": "xyz" } }))).toBeUndefined();
    expect(parseHistoryLine(JSON.stringify({ ...entry, at: "soon" }))).toBeUndefined();
  });
});
