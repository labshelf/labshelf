/** @jest-environment jsdom */
// LaTeX and Typst decks run in the shell: mountDeckWorkspace over fake ports (editing, build, mode, pdf that reads nothing) renders the shell's header,
// zoom bar and layout, binds the shell keys on its root, and its insert buttons target the current slide or the poster's last block.
// Acceptance ids: A4 = the shell renders / the keys / the insert targets; A1 = existing behaviour holds (covered by the existing suites the command also runs).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TYPST, flush, mount, talk, poster, button, statusLeft, zoomLabel } from "./workspaceHarness";

describe("the shell on a mounted workspace: header", () => {
  const modeTabs = (rig: ReturnType<typeof talk>): HTMLElement[] => [...rig.root.querySelectorAll<HTMLElement>('.dw-header [role="tablist"][aria-label="Mode"] [role="tab"]')];
  const viewButton = (rig: ReturnType<typeof talk>, group: "Code" | "View", label: string): HTMLButtonElement =>
    rig.root.querySelector<HTMLButtonElement>(group === "Code" ? `.dw-code-bar .dw-modes[aria-label="Code"] button[aria-label="${label}"]` : `.dw-pane-bar > button[aria-label="${label}"]`)!;
  const pressed = (rig: ReturnType<typeof talk>, group: "Code" | "View", labels: string[]): Array<string | null> => labels.map((label) => viewButton(rig, group, label).getAttribute("aria-pressed"));

  it("A4 a talk has no mode tabs and no header buttons: Slide and File and Preview are in the code bar, Grid in the preview bar", async () => {
    const rig = talk();
    await flush();
    expect(modeTabs(rig)).toEqual([]);
    expect(rig.root.querySelectorAll('.dw-header [role="tab"]')).toHaveLength(0);
    expect(rig.root.querySelectorAll(".dw-header button")).toHaveLength(0);
    expect([...rig.root.querySelectorAll(".dw-code-bar .dw-modes[aria-label=Code] button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Slide", "File"]);
    expect(viewButton(rig, "View", "Grid").closest(".dw-stage-bar")).not.toBeNull();
    expect(viewButton(rig, "View", "Preview").closest(".dw-code-bar")).not.toBeNull();
    expect(viewButton(rig, "View", "Preview").classList.contains("dw-eye")).toBe(true);
  });

  it("A4 a talk starts in Split with Slide, Preview pressed and Grid, File not", async () => {
    const rig = talk();
    await flush();
    expect(rig.root.dataset["mode"]).toBe("split");
    expect(pressed(rig, "Code", ["Slide", "File"])).toEqual(["true", "false"]);
    expect(pressed(rig, "View", ["Grid", "Preview"])).toEqual(["false", "true"]);
  });

  it("A4 a poster has no mode tabs: its view controls hold Block and File (Code) and Preview (View), and it starts in Split by Block", async () => {
    const rig = poster();
    await flush();
    expect(modeTabs(rig)).toEqual([]);
    expect([...rig.root.querySelectorAll(".dw-code-bar .dw-modes[aria-label=Code] button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Block", "File"]);
    expect(rig.root.querySelector('.dw-pane-bar button[aria-label="Grid"]')).toBeNull();
    expect(rig.root.dataset["mode"]).toBe("split");
    expect(pressed(rig, "Code", ["Block", "File"])).toEqual(["true", "false"]);
    expect(pressed(rig, "View", ["Preview"])).toEqual(["true"]);
  });

  it("A4 a talk has no Visual mode: setMode(visual) and a stored visual mode both give Split", async () => {
    const stored = talk({ mode: "visual" });
    await flush();
    expect(stored.workspace.mode()).toBe("split");
    expect(stored.root.dataset["mode"]).toBe("split");
    stored.workspace.setMode("code");
    stored.workspace.setMode("visual");
    expect(stored.workspace.mode()).toBe("split");
  });

  it("A4 the Preview button of a poster toggles Split and Code and keeps the mode in the mode port; a stored visual mode opens Split", async () => {
    const rig = poster({ mode: "visual" });
    await flush();
    expect(rig.workspace.mode()).toBe("split");
    viewButton(rig, "View", "Preview").click();
    expect(rig.workspace.mode()).toBe("code");
    expect(rig.modes.at(-1)).toBe("code");
    expect(rig.root.dataset["mode"]).toBe("code");
    expect(pressed(rig, "View", ["Preview"])).toEqual(["false"]);
    viewButton(rig, "View", "Preview").click();
    expect(rig.root.dataset["mode"]).toBe("split");
    rig.workspace.setMode("visual");
    expect(rig.workspace.mode()).toBe("split");
  });

  it("A4 the Preview button of a talk toggles Split and Code, keeps the mode in the mode port and moves its pressed state and the root's data-mode", async () => {
    const rig = talk();
    await flush();
    viewButton(rig, "View", "Preview").click();
    expect(rig.workspace.mode()).toBe("code");
    expect(rig.modes.at(-1)).toBe("code");
    expect(rig.root.dataset["mode"]).toBe("code");
    expect(pressed(rig, "View", ["Grid", "Preview"])).toEqual(["false", "false"]);
    viewButton(rig, "View", "Preview").click();
    expect(rig.workspace.mode()).toBe("split");
    expect(pressed(rig, "View", ["Grid", "Preview"])).toEqual(["false", "true"]);
  });

  it("A4 workspace.setMode moves a poster's Preview pressed state and the root's data-mode too", async () => {
    const rig = poster();
    await flush();
    rig.workspace.setMode("code");
    expect(pressed(rig, "View", ["Preview"])).toEqual(["false"]);
    expect(rig.root.dataset["mode"]).toBe("code");
  });

  it("A4 workspace.setMode moves a talk's Preview and Grid pressed states and the root's data-mode", async () => {
    const rig = talk();
    await flush();
    rig.workspace.setMode("code");
    expect(rig.root.dataset["mode"]).toBe("code");
    expect(pressed(rig, "View", ["Grid", "Preview"])).toEqual(["false", "false"]);
    rig.workspace.setMode("grid");
    expect(rig.root.dataset["mode"]).toBe("split");
    expect(rig.root.dataset["grid"]).toBe("true");
    expect(pressed(rig, "View", ["Grid", "Preview"])).toEqual(["true", "true"]);
  });

  it("A4 starts in the mode the mode port keeps", async () => {
    const rig = poster({ mode: "code" });
    await flush();
    expect(rig.root.dataset["mode"]).toBe("code");
    const code = talk({ mode: "code" });
    await flush();
    expect(code.root.dataset["mode"]).toBe("code");
    expect(pressed(code, "View", ["Grid", "Preview"])).toEqual(["false", "false"]);
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
    const build = rig.root.querySelector<HTMLButtonElement>(".dw-code-bar .dw-build")!;
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
    const build = rig.root.querySelector<HTMLButtonElement>(".dw-code-bar .dw-build")!;
    expect(build.dataset["state"]).toBe("failed");
    expect(build.textContent).toContain("2");
    build.click();
    expect(rig.calls.showProblems).toBe(1);
    expect(rig.calls.buildRun).toBe(0);
  });

  it("A4 the code bar holds the code view, the insert groups, Build and Preview; the preview bar holds Grid or the shape, the panels and the shows", async () => {
    const rig = talk();
    const latexPoster = poster();
    await flush();
    const bar = (r: ReturnType<typeof talk>, name: "code" | "stage"): HTMLElement => r.root.querySelector<HTMLElement>(`.dw-${name}-bar`)!;
    expect(bar(rig, "code").parentElement!.closest(".dw-code")).not.toBeNull();
    expect(bar(rig, "stage").parentElement!.classList.contains("dw-stage-column")).toBe(true);
    for (const label of ["Slide", "File", "New slide", "Text", "Layout", "Preview"]) expect(button(bar(rig, "code"), label)).not.toBeNull();
    expect(bar(rig, "code").querySelector(".dw-build")).not.toBeNull();
    expect(bar(rig, "code").querySelector(".dw-icon-only")).not.toBeNull();
    for (const label of ["Grid", "Aspect ratio", "Style", "Export PDF", "Present"]) expect(button(bar(rig, "stage"), label)).not.toBeNull();
    expect(button(bar(rig, "code"), "Aspect ratio")).toBeNull();
    for (const label of ["Block", "File", "Block", "Text", "Preview"]) expect(button(bar(latexPoster, "code"), label)).not.toBeNull();
    for (const label of ["Size", "Style", "Poster", "Export PDF", "Real size"]) expect(button(bar(latexPoster, "stage"), label)).not.toBeNull();
    expect(button(bar(latexPoster, "stage"), "Grid")).toBeNull();
    expect(button(bar(latexPoster, "code"), "Size")).toBeNull();
  });

  it("A4 in Code the Export and show buttons move to the code bar's end, and back to the preview bar in Split", async () => {
    for (const rig of [talk(), poster()]) {
      await flush();
      const show = rig.root.querySelector<HTMLElement>(".dw-header-button")!;
      const shows = (): HTMLElement[] => [...rig.root.querySelectorAll<HTMLElement>(".dw-header-button")];
      expect(shows().every((b) => b.closest(".dw-stage-bar .dw-pane-end"))).toBe(true);
      rig.workspace.setMode("code");
      expect(shows().every((b) => b.closest(".dw-code-bar .dw-pane-end"))).toBe(true);
      expect(show.closest(".dw-code-bar")).not.toBeNull();
      rig.workspace.setMode("split");
      expect(shows().every((b) => b.closest(".dw-stage-bar .dw-pane-end"))).toBe(true);
    }
  });

  it("A4 a talk's header has Export PDF and Present, and Present calls ports.present", async () => {
    const rig = talk();
    await flush();
    const header = rig.root.querySelector(".dw-stage-bar")!;
    expect(button(header, "Export PDF")).not.toBeNull();
    expect(button(header, "Real size")).toBeNull();
    button(header, "Present").click();
    expect(rig.calls.present).toBe(1);
    expect(rig.calls.posterPreview).toBe(0);
  });

  it("A4 a poster's header has Export PDF and Real size, and Real size calls ports.posterPreview", async () => {
    const rig = poster();
    await flush();
    const header = rig.root.querySelector(".dw-stage-bar")!;
    expect(button(header, "Present")).toBeNull();
    button(header, "Real size").click();
    expect(rig.calls.posterPreview).toBe(1);
    expect(rig.calls.present).toBe(0);
  });

  it("A4 Export PDF calls ports.exportPdf", async () => {
    const rig = poster();
    await flush();
    button(rig.root.querySelector(".dw-stage-bar")!, "Export PDF").click();
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
  it("A4 a poster's zoom bar has Zoom out, the zoom label, Zoom in, Fit and Zoom to section (no Select, Hand or Guides), and the minimap", async () => {
    const rig = poster();
    await flush();
    const zoom = rig.root.querySelector<HTMLElement>('.dw-stage-column [role="toolbar"][aria-label="Zoom"]')!;
    expect(zoom).not.toBeNull();
    expect([...zoom.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Zoom out", "Zoom in", "Fit", "Zoom to section"]);
    expect(zoom.querySelector(".dw-zoom-label")).not.toBeNull();
    expect(rig.root.querySelector(".dw-stage .dsh-minimap, .dw-stage [class*='minimap']")).not.toBeNull();
  });

  it("A4 a talk's zoom bar has only Zoom out, the zoom label, Zoom in and Fit (no Select, Hand or Guides)", async () => {
    const rig = talk();
    await flush();
    const zoom = rig.root.querySelector<HTMLElement>('.dw-stage-column [role="toolbar"][aria-label="Zoom"]')!;
    expect(zoom).not.toBeNull();
    expect([...zoom.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Zoom out", "Zoom in", "Fit"]);
    expect(zoom.querySelector(".dw-zoom-label")).not.toBeNull();
    for (const label of ["Select", "Hand", "Guides"]) expect(button(zoom, label)).toBeNull();
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
