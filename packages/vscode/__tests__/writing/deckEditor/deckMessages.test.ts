// Tests that parseDeckPageMessage keeps the four page message shapes, drops unknown keys and turns anything else into null.
import { parseDeckPageMessage } from "../../../src/writing/deckEditor/deckMessages";

const COMMANDS = ["present", "posterPreview", "exportPdf", "exportHtml", "shareLink", "insertQr"] as const;

describe("parseDeckPageMessage", () => {
  it("8.1f accepts ready", () => {
    expect(parseDeckPageMessage({ type: "ready" })).toEqual({ type: "ready" });
  });

  it("8.1f accepts save", () => {
    expect(parseDeckPageMessage({ type: "save" })).toEqual({ type: "save" });
  });

  it("8.1f accepts an edit with deck, theme and baseVersion", () => {
    expect(parseDeckPageMessage({ type: "edit", deck: "<html></html>", theme: ":root{}", baseVersion: 3 }))
      .toEqual({ type: "edit", deck: "<html></html>", theme: ":root{}", baseVersion: 3 });
  });

  it("8.1f accepts an edit without theme", () => {
    const message = parseDeckPageMessage({ type: "edit", deck: "", baseVersion: 0 });
    expect(message).toEqual({ type: "edit", deck: "", baseVersion: 0 });
    expect(message && "theme" in message ? message.theme : undefined).toBeUndefined();
  });

  it.each(COMMANDS)("8.1f accepts the command %s", (command) => {
    expect(parseDeckPageMessage({ type: "command", command })).toEqual({ type: "command", command });
  });

  it("8.1f drops unknown keys", () => {
    expect(parseDeckPageMessage({ type: "ready", extra: 1 })).toStrictEqual({ type: "ready" });
    expect(parseDeckPageMessage({ type: "save", path: "/x" })).toStrictEqual({ type: "save" });
    expect(parseDeckPageMessage({ type: "edit", deck: "d", baseVersion: 1, label: "Move" })).toEqual({ type: "edit", deck: "d", baseVersion: 1 });
    expect(parseDeckPageMessage({ type: "edit", deck: "d", baseVersion: 1, label: "Move" })).not.toHaveProperty("label");
    expect(parseDeckPageMessage({ type: "command", command: "present", uri: "/x" })).toStrictEqual({ type: "command", command: "present" });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "ready"],
    ["a number", 1],
    ["an array", [{ type: "ready" }]],
    ["an object without type", { deck: "d", baseVersion: 1 }],
    ["an unknown type", { type: "init" }],
    ["a non-string type", { type: 1 }],
  ])("8.1f rejects %s", (_name, value) => {
    expect(parseDeckPageMessage(value)).toBeNull();
  });

  it.each([
    ["a missing deck", { type: "edit", baseVersion: 1 }],
    ["a non-string deck", { type: "edit", deck: 1, baseVersion: 1 }],
    ["a non-string theme", { type: "edit", deck: "d", theme: 1, baseVersion: 1 }],
    ["a null theme", { type: "edit", deck: "d", theme: null, baseVersion: 1 }],
    ["a missing baseVersion", { type: "edit", deck: "d" }],
    ["a negative baseVersion", { type: "edit", deck: "d", baseVersion: -1 }],
    ["a fractional baseVersion", { type: "edit", deck: "d", baseVersion: 1.5 }],
    ["a string baseVersion", { type: "edit", deck: "d", baseVersion: "1" }],
    ["a NaN baseVersion", { type: "edit", deck: "d", baseVersion: Number.NaN }],
  ])("8.1f rejects an edit with %s", (_name, value) => {
    expect(parseDeckPageMessage(value)).toBeNull();
  });

  it.each([
    ["a missing command", { type: "command" }],
    ["an unknown command", { type: "command", command: "delete" }],
    ["a non-string command", { type: "command", command: 1 }],
    ["a command id instead of a name", { type: "command", command: "labshelf.decks.present" }],
  ])("8.1f rejects a command with %s", (_name, value) => {
    expect(parseDeckPageMessage(value)).toBeNull();
  });
});

describe("parseDeckPageMessage: kits", () => {
  const kit = { name: "Lab", style: {} };
  const logo = { name: "logo.png", base64: "AAEC" };

  it("4b.3c keeps the list, save and pickImage shapes and drops unknown keys", () => {
    expect(parseDeckPageMessage({ type: "kits", id: 1, request: "list", extra: 1 })).toEqual({ type: "kits", id: 1, request: "list" });
    expect(parseDeckPageMessage({ type: "kits", id: 2, request: "pickImage", kit })).toEqual({ type: "kits", id: 2, request: "pickImage" });
    expect(parseDeckPageMessage({ type: "kits", id: 3, request: "save", kit })).toEqual({ type: "kits", id: 3, request: "save", kit });
    expect(parseDeckPageMessage({ type: "kits", id: 4, request: "save", kit, logo: { ...logo, path: "/etc" } })).toEqual({ type: "kits", id: 4, request: "save", kit, logo });
  });

  it.each([
    ["no id", { type: "kits", request: "list" }],
    ["a negative id", { type: "kits", id: -1, request: "list" }],
    ["an unknown request", { type: "kits", id: 1, request: "delete" }],
    ["a save without a kit", { type: "kits", id: 1, request: "save" }],
    ["a kit that is not an object", { type: "kits", id: 1, request: "save", kit: [] }],
    ["a logo without bytes", { type: "kits", id: 1, request: "save", kit, logo: { name: "a.png" } }],
    ["a logo with a numeric name", { type: "kits", id: 1, request: "save", kit, logo: { name: 1, base64: "AA" } }],
  ])("4b.3c rejects a kits message with %s", (_name, value) => {
    expect(parseDeckPageMessage(value)).toBeNull();
  });
});
