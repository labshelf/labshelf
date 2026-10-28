// Pins the browser tab registry: each kind loads a body module.
import { TAB_KINDS } from "../../../src/libraryUi/editorArea";

describe("tab kinds", () => {
  it("loads each kind's body as a module with mountTab", async () => {
    for (const kind of Object.values(TAB_KINDS)) expect(typeof (await kind.load()).mountTab).toBe("function");
  });
});
