// The open-editor registry reveals a line in a mounted editor and holds a reveal asked for before the editor mounted.
import { registerOpenEditor, showInOpenEditor } from "../../../src/writing/session";

describe("open editors", () => {
  it("reveals the line in the editor registered for the file", () => {
    const revealLine = jest.fn();
    const off = registerOpenEditor("p1", "main.tex", { revealLine, flush: async () => true, reload: async () => undefined });
    showInOpenEditor("p1", "main.tex", 4);
    expect(revealLine).toHaveBeenCalledWith(4);
    off();
  });

  it("applies a reveal asked for while the editor was still loading", () => {
    showInOpenEditor("p2", "a:b.tex", 9);
    const revealLine = jest.fn();
    registerOpenEditor("p2", "a:b.tex", { revealLine, flush: async () => true, reload: async () => undefined })();
    expect(revealLine).toHaveBeenCalledWith(9);
  });

  it("forgets a disposed editor", () => {
    const revealLine = jest.fn();
    registerOpenEditor("p3", "main.tex", { revealLine, flush: async () => true, reload: async () => undefined })();
    showInOpenEditor("p3", "main.tex", 1);
    expect(revealLine).not.toHaveBeenCalled();
  });
});
