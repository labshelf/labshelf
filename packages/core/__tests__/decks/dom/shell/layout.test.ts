/** @jest-environment jsdom */
// Spec 2.1: the generic deck shell core in decks/dom/shell/ — the layout.
// Every part is driven through its factory and read back from the DOM it builds; no format logic is involved.
// Acceptance ids: A4 covers all six parts (header, insert bar, status, zoom bar, keys, layout); each test name says which.
import { closeMenu } from "../../../../src/ui/dom/index.js";
import { mountDeckShell, type DeckShellParts } from "../../../../src/decks/dom/shell/index.js";
import { q } from "./shellHarness.js";

afterEach(() => {
  closeMenu();
  document.body.replaceChildren();
});

describe("A4 layout", () => {
  const el = (name: string, tag = "div"): HTMLElement => {
    const made = document.createElement(tag);
    made.dataset["part"] = name;
    return made;
  };
  const makeParts = (over: Partial<DeckShellParts> = {}): DeckShellParts => ({
    format: "latex", kind: "talk",
    header: el("header", "header"), insert: el("insert"), left: el("left"), stage: el("stage"), zoom: el("zoom"), props: el("props"), status: el("status", "footer"),
    ...over,
  });
  const mount = (over: Partial<DeckShellParts> = {}) => {
    const host = document.createElement("div");
    document.body.append(host);
    const parts = makeParts(over);
    const shell = mountDeckShell(host, parts);
    return { host, parts, shell };
  };
  const parts = (container: Element): Array<string | undefined> => Array.from(container.children).map((c) => (c as HTMLElement).dataset["part"] ?? c.className);

  it("A4 layout appends div.dw to the host and returns it as root", () => {
    const { host, shell } = mount();
    expect(shell.root.tagName).toBe("DIV");
    expect(shell.root.classList.contains("dw")).toBe(true);
    expect(shell.root.parentElement).toBe(host);
  });

  it("A4 layout carries data-format, data-kind and data-mode visual", () => {
    const { shell } = mount({ format: "typst", kind: "poster" });
    expect(shell.root.dataset["format"]).toBe("typst");
    expect(shell.root.dataset["kind"]).toBe("poster");
    expect(shell.root.dataset["mode"]).toBe("visual");
  });

  it("A4 layout orders header, insert, body, status", () => {
    const { shell } = mount();
    expect(parts(shell.root)).toEqual(["header", "insert", "dw-body", "status"]);
  });

  it("A4 layout without a code part has left, stage column and props in the body, and no code pane or divider", () => {
    const { shell } = mount();
    const body = q(shell.root, ".dw-body");
    expect(parts(body)).toEqual(["left", "dw-stage-column", "props"]);
    expect(shell.root.querySelector(".dw-code")).toBeNull();
    expect(shell.root.querySelector(".dw-divider")).toBeNull();
  });

  it("A4 layout with a code part has left, code pane, stage column and props in the body", () => {
    const { shell } = mount({ code: el("code") });
    expect(parts(q(shell.root, ".dw-body"))).toEqual(["left", "dw-code", "dw-stage-column", "props"]);
  });

  it("A4 layout code pane holds the code part and then a resize divider", () => {
    const { shell } = mount({ code: el("code") });
    const pane = q(shell.root, ".dw-code");
    expect(parts(pane)).toEqual(["code", "dw-divider"]);
    const divider = q(pane, ".dw-divider");
    expect(divider.getAttribute("role")).toBe("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    expect(divider.getAttribute("aria-label")).toBe("Resize");
  });

  it("A4 layout puts the zoom inside the stage", () => {
    const { shell, parts: p } = mount();
    expect(p.zoom.parentElement).toBe(p.stage);
    expect(p.stage.parentElement).toBe(q(shell.root, ".dw-stage-column"));
  });

  it("A4 layout stage column holds the stage alone without notes", () => {
    const { shell } = mount();
    expect(parts(q(shell.root, ".dw-stage-column"))).toEqual(["stage"]);
  });

  it("A4 layout puts the notes under the stage", () => {
    const { shell } = mount({ notes: el("notes") });
    expect(parts(q(shell.root, ".dw-stage-column"))).toEqual(["stage", "notes"]);
  });

  it("A4 layout setMode sets data-mode on the root", () => {
    const { shell } = mount({ code: el("code") });
    shell.setMode("split");
    expect(shell.root.dataset["mode"]).toBe("split");
    shell.setMode("code");
    expect(shell.root.dataset["mode"]).toBe("code");
    shell.setMode("visual");
    expect(shell.root.dataset["mode"]).toBe("visual");
  });

  it("A4 layout destroy removes the root from the host", () => {
    const { host, shell } = mount();
    shell.destroy();
    expect(shell.root.isConnected).toBe(false);
    expect(host.querySelector(".dw")).toBeNull();
  });

  describe("divider drag", () => {
    const drag = (clientX: number): HTMLElement => {
      const { shell } = mount({ code: el("code") });
      const body = q(shell.root, ".dw-body");
      body.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600, x: 0, y: 0, toJSON() {} });
      const divider = q(shell.root, ".dw-divider");
      divider.setPointerCapture = jest.fn();
      divider.releasePointerCapture = jest.fn();
      divider.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX }));
      divider.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX }));
      divider.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true, clientX }));
      return shell.root;
    };

    it("A4 layout dragging the divider sets --dw-code-width as a percentage of the body", () => {
      expect(drag(450).style.getPropertyValue("--dw-code-width")).toBe("45%");
    });

    it("A4 layout dragging the divider clamps --dw-code-width at 20%", () => {
      expect(drag(40).style.getPropertyValue("--dw-code-width")).toBe("20%");
    });

    it("A4 layout dragging the divider clamps --dw-code-width at 80%", () => {
      expect(drag(990).style.getPropertyValue("--dw-code-width")).toBe("80%");
    });
  });
});
