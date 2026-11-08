/** @jest-environment jsdom */
// LaTeX and Typst decks run in the shell: mountDeckWorkspace over fake ports (editing, build, mode, pdf that reads nothing) renders the shell's header,
// zoom bar and layout, binds the shell keys on its root, and its insert buttons target the current slide or the poster's last block.
// Acceptance ids: A4 = the shell renders / the keys / the insert targets; A1 = existing behaviour holds (covered by the existing suites the command also runs).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TYPST, flush, mount, talk, poster, button, statusLeft, zoomLabel } from "./workspaceHarness";

describe("the shell on a mounted workspace: header", () => {
  it("A4 renders Visual, Split and Code tabs (and Grid for a talk, spec 6.2) with the mode selected", async () => {
    const rig = talk();
    await flush();
    const tabs = [...rig.root.querySelectorAll<HTMLElement>('.dw-header [role="tablist"][aria-label="Mode"] [role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual(["Visual", "Split", "Code", "Grid"]);
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false", "false"]);
  });

  it("A4 a click on a tab changes the workspace mode, keeps it in the mode port and moves the selected tab and the root's data-mode", async () => {
    const rig = talk();
    await flush();
    button(rig.root, "Split").click();
    expect(rig.workspace.mode()).toBe("split");
    expect(rig.modes.at(-1)).toBe("split");
    expect(rig.root.dataset["mode"]).toBe("split");
    expect(button(rig.root, "Split").getAttribute("aria-selected")).toBe("true");
    expect(button(rig.root, "Visual").getAttribute("aria-selected")).toBe("false");
  });

  it("A4 workspace.setMode moves the selected tab and the root's data-mode too", async () => {
    const rig = talk();
    await flush();
    rig.workspace.setMode("code");
    expect(button(rig.root, "Code").getAttribute("aria-selected")).toBe("true");
    expect(rig.root.dataset["mode"]).toBe("code");
  });

  it("A4 starts in the mode the mode port keeps", async () => {
    const rig = talk({ mode: "split" });
    await flush();
    expect(rig.root.dataset["mode"]).toBe("split");
    expect(button(rig.root, "Split").getAttribute("aria-selected")).toBe("true");
  });

  it("A4 shows the LaTeX badge for a .tex deck and the Typst badge for a .typ deck", async () => {
    const latex = talk();
    const typst = mount("posters/demo/main.typ", TYPST);
    await flush();
    expect(latex.root.querySelector(".dw-header .dw-badge")!.textContent).toBe("LaTeX");
    expect(typst.root.querySelector(".dw-header .dw-badge")!.textContent).toBe("Typst");
  });

  it("A4 the root keeps class dw and data-kind and gains data-format", async () => {
    const latexTalk = talk();
    const typstPoster = mount("posters/demo/main.typ", TYPST);
    await flush();
    expect([latexTalk.root.dataset["format"], latexTalk.root.dataset["kind"]]).toEqual(["latex", "talk"]);
    expect([typstPoster.root.dataset["format"], typstPoster.root.dataset["kind"]]).toEqual(["typst", "poster"]);
  });

  it("A4 the build button follows the build state and a click on it builds", async () => {
    const rig = talk();
    await flush();
    const build = rig.root.querySelector<HTMLButtonElement>(".dw-header .dw-build")!;
    expect(build.dataset["state"]).toBe("none");
    build.click();
    expect(rig.calls.buildRun).toBe(1);
    rig.emitBuild({ state: "building", errors: 0 });
    expect(build.dataset["state"]).toBe("building");
    build.click();
    expect(rig.calls.buildRun).toBe(1);
    rig.emitBuild({ state: "succeeded", errors: 0 });
    expect(build.dataset["state"]).toBe("succeeded");
  });

  it("A4 the build button opens the problems after a failed build", async () => {
    const rig = talk();
    await flush();
    rig.emitBuild({ state: "failed", errors: 2 });
    const build = rig.root.querySelector<HTMLButtonElement>(".dw-header .dw-build")!;
    expect(build.dataset["state"]).toBe("failed");
    expect(build.textContent).toContain("2");
    build.click();
    expect(rig.calls.showProblems).toBe(1);
    expect(rig.calls.buildRun).toBe(0);
  });

  it("A4 a talk's header has Export PDF and Present, and Present calls ports.present", async () => {
    const rig = talk();
    await flush();
    const header = rig.root.querySelector(".dw-header")!;
    expect(button(header, "Export PDF")).not.toBeNull();
    expect(button(header, "Real size")).toBeNull();
    button(header, "Present").click();
    expect(rig.calls.present).toBe(1);
    expect(rig.calls.posterPreview).toBe(0);
  });

  it("A4 a poster's header has Export PDF and Real size, and Real size calls ports.posterPreview", async () => {
    const rig = poster();
    await flush();
    const header = rig.root.querySelector(".dw-header")!;
    expect(button(header, "Present")).toBeNull();
    button(header, "Real size").click();
    expect(rig.calls.posterPreview).toBe(1);
    expect(rig.calls.present).toBe(0);
  });

  it("A4 Export PDF calls ports.exportPdf", async () => {
    const rig = poster();
    await flush();
    button(rig.root.querySelector(".dw-header")!, "Export PDF").click();
    expect(rig.calls.exportPdf).toBe(1);
  });

  it("A4 Present and Real size are the header's primary button", async () => {
    const latexTalk = talk();
    const latexPoster = poster();
    await flush();
    expect(button(latexTalk.root, "Present").classList.contains("dw-primary")).toBe(true);
    expect(button(latexPoster.root, "Real size").classList.contains("dw-primary")).toBe(true);
  });
});

describe("the shell on a mounted workspace: zoom bar and layout", () => {
  it("A4 has the shell's zoom bar with Select, Hand, Guides, Zoom out, Zoom in and Fit inside the stage column", async () => {
    const rig = talk();
    await flush();
    const zoom = rig.root.querySelector<HTMLElement>('.dw-stage-column [role="toolbar"][aria-label="Zoom"]');
    expect(zoom).not.toBeNull();
    for (const label of ["Select", "Hand", "Guides", "Zoom out", "Zoom in", "Fit"]) expect(button(zoom!, label)).not.toBeNull();
  });

  it("A4 the Guides button toggles the guides and its pressed state", async () => {
    const rig = poster();
    await flush();
    const guides = button(rig.root, "Guides");
    expect(guides.getAttribute("aria-pressed")).toBe("false");
    guides.click();
    expect(guides.getAttribute("aria-pressed")).toBe("true");
    guides.click();
    expect(guides.getAttribute("aria-pressed")).toBe("false");
  });

  it("A4 the Hand and Select buttons switch the pressed tool", async () => {
    const rig = talk();
    await flush();
    expect(button(rig.root, "Select").getAttribute("aria-pressed")).toBe("true");
    button(rig.root, "Hand").click();
    expect(button(rig.root, "Hand").getAttribute("aria-pressed")).toBe("true");
    expect(button(rig.root, "Select").getAttribute("aria-pressed")).toBe("false");
    button(rig.root, "Select").click();
    expect(button(rig.root, "Select").getAttribute("aria-pressed")).toBe("true");
  });

  it("A4 the Zoom in and Fit buttons change the zoom label between N% and Fit · N%", async () => {
    const rig = talk();
    await flush();
    button(rig.root, "Zoom in").click();
    expect(zoomLabel(rig)).toMatch(/^\d+%$/);
    button(rig.root, "Fit").click();
    expect(zoomLabel(rig)).toMatch(/^Fit · \d+%$/);
  });

  it("A4 lays out the header, insert bar, body and status in that order", async () => {
    const rig = talk();
    await flush();
    expect([...rig.root.children].map((child) => child.className.split(" ")[0])).toEqual(["dw-header", "dw-insertbar", "dw-body", "dw-status"]);
  });

  it("A4 puts the host's editor in the code pane next to a resize divider", async () => {
    const rig = talk();
    await flush();
    const code = rig.root.querySelector(".dw-body > .dw-code")!;
    expect(code.contains(rig.editor)).toBe(true);
    expect(code.querySelector('[role="separator"][aria-label="Resize"]')).not.toBeNull();
  });

  it("A4 keeps the structure and properties panels around the stage column", async () => {
    const rig = poster();
    await flush();
    expect(rig.root.querySelector(".dw-body .dw-structure")).not.toBeNull();
    expect(rig.root.querySelector(".dw-body .dw-stage-column")).not.toBeNull();
  });

  it("A4 a talk has speaker notes under the stage", async () => {
    const rig = talk();
    await flush();
    const column = rig.root.querySelector(".dw-stage-column")!;
    expect(column.querySelector('textarea[aria-label="Speaker notes"]')).not.toBeNull();
  });

  it("A4 the status bar shows the slide of a talk and the shell's Previous and Next buttons", async () => {
    const rig = talk();
    await flush();
    expect(statusLeft(rig)).toMatch(/^Slide 1 of 4/);
    expect(button(rig.root.querySelector(".dw-status")!, "Previous slide").disabled).toBe(true);
    button(rig.root.querySelector(".dw-status")!, "Next slide").click();
    expect(statusLeft(rig)).toMatch(/^Slide 2 of 4/);
  });

  it("A4 workspace/header.ts no longer exists", () => {
    expect(existsSync(join(__dirname, "..", "..", "..", "..", "src", "decks", "dom", "workspace", "header.ts"))).toBe(false);
  });

  it("A4 dispose removes the root from the host and stops the ports' listeners", async () => {
    const rig = talk();
    await flush();
    rig.workspace.dispose();
    expect(rig.host.querySelector(".dw")).toBeNull();
    expect(rig.calls.unsubscribed).toBeGreaterThan(0);
    expect(rig.calls.stoppedBuild).toBeGreaterThan(0);
  });
});
