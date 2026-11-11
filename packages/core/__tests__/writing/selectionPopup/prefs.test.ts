/** Verifies the selection popup settings in editor-prefs.json and in the source editor protocol. */
import { DEFAULT_NOTE_POPUP, DEFAULT_SELECTION_POPUP, parseEditorPrefs, parseSourceEditorInbound, parseSourceEditorOutbound, parseSelectionPopupPrefs, serializeEditorPrefs } from "../../../src/index";

describe("selection popup prefs", () => {
  it("reads defaults for a missing or invalid value and keeps unknown hidden ids", () => {
    expect(parseSelectionPopupPrefs(undefined)).toEqual(DEFAULT_SELECTION_POPUP);
    expect(parseSelectionPopupPrefs({ trigger: "sometimes", onClick: "yes", contextual: false, hidden: ["bold", 3, "future"] }))
      .toEqual({ trigger: "mouse", onClick: true, contextual: false, hidden: ["bold", "future"] });
  });

  it("reads a stored shortcut trigger as never", () => {
    expect(parseSelectionPopupPrefs({ trigger: "shortcut" }).trigger).toBe("never");
  });

  it("round-trips notePopup with its own defaults beside selectionPopup", () => {
    expect(parseSelectionPopupPrefs({}, DEFAULT_NOTE_POPUP)).toEqual({ trigger: "any", onClick: true, contextual: true, hidden: [] });
    const text = JSON.stringify({ version: 1, notePopup: { trigger: "never", hidden: ["bold"] } });
    const prefs = parseEditorPrefs(text);
    expect(prefs.notePopup).toEqual({ trigger: "never", onClick: true, contextual: true, hidden: ["bold"] });
    expect(prefs.extra).toEqual({});
    const written = serializeEditorPrefs(prefs);
    expect(JSON.parse(written).notePopup).toEqual({ contextual: true, hidden: ["bold"], onClick: true, trigger: "never" });
    expect(serializeEditorPrefs(parseEditorPrefs(written))).toBe(written);
  });

  it("round-trips editor-prefs.json with selectionPopup, keeping other keys", () => {
    const text = JSON.stringify({ version: 1, other: 1, selectionPopup: { trigger: "any", onClick: true, contextual: true, hidden: ["quotes", "bold"] } });
    const prefs = parseEditorPrefs(text);
    expect(prefs.selectionPopup).toEqual({ trigger: "any", onClick: true, contextual: true, hidden: ["quotes", "bold"] });
    const written = serializeEditorPrefs(prefs);
    expect(JSON.parse(written).selectionPopup).toEqual({ contextual: true, hidden: ["bold", "quotes"], onClick: true, trigger: "any" });
    expect(JSON.parse(written).other).toBe(1);
    expect(serializeEditorPrefs(parseEditorPrefs(written))).toBe(written);
  });

  it("leaves the key out of a file that has none", () => {
    expect(parseEditorPrefs(JSON.stringify({ version: 1 })).selectionPopup).toBeUndefined();
    expect(serializeEditorPrefs(parseEditorPrefs(null))).not.toContain("selectionPopup");
  });

  it("parses setSelectionPopup and the selectionPopup message strictly", () => {
    const selectionPopup = { trigger: "shortcut", onClick: false, contextual: true, hidden: [] };
    expect(parseSourceEditorOutbound({ type: "request", id: 1, method: "setSelectionPopup", params: { selectionPopup } })).toMatchObject({ params: { selectionPopup: { trigger: "never" } } });
    expect(parseSourceEditorOutbound({ type: "request", id: 1, method: "setSelectionPopup", params: { selectionPopup: { ...selectionPopup, trigger: "x" } } })).toBeUndefined();
    expect(parseSourceEditorInbound({ type: "selectionPopup", selectionPopup })).toEqual({ type: "selectionPopup", selectionPopup: { ...selectionPopup, trigger: "never" } });
  });
});
