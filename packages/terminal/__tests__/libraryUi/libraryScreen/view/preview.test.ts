import { promises as fs } from "node:fs";

import type { AppContext } from "../../../../src/compositionRoot";
import { App } from "../../../../src/libraryUi/libraryScreen";
import { theme } from "../../../../src/libraryUi/theme";
import { ATTENTION, BERT, eventually, highlight, idle, makeTmpRoot, openApp, pane, press, seedLibrary, writeSidecar } from "../../../fixtures/appHarness";
import { deriveLayout } from "../../../../src/libraryUi/render";

let tmp: string;
let root: string;
let ctx: AppContext;
let app: App;

beforeEach(async () => {
  ({ tmp, root } = await makeTmpRoot());
  await seedLibrary(root);
  ({ ctx, app } = await openApp(root, tmp));
});

afterEach(async () => {
  await idle(app).catch(() => undefined);
  await ctx.dispose();
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("App preview tabs", () => {
  it("cycles the tabs with Tab and Shift-Tab", () => {
    expect(app.previewTab).toBe(0);
    press(app, "tab");
    expect(app.previewTab).toBe(1);
    press(app, "tab", "tab");
    expect(app.previewTab).toBe(3);
    press(app, "tab");
    expect(app.previewTab).toBe(0);
    press(app, "S-tab");
    expect(app.previewTab).toBe(3);
    press(app, "S-tab");
    expect(app.previewTab).toBe(2);
  });

  it("shows the abstract on the second tab", () => {
    press(app, "tab");
    expect(pane(app, "preview")).toContain("The dominant sequence transduction");
    expect(pane(app, "preview")).not.toContain("Status ○ unread");
  });

  it("says when a paper has no abstract", () => {
    press(app, "j", "tab");
    expect(app.hoveredPaper()?.record.id).toBe(BERT);
    expect(pane(app, "preview")).toContain("No abstract stored for this paper.");
  });

  it("shows the BibTeX on the fourth tab", () => {
    press(app, "S-tab");
    expect(pane(app, "preview")).toContain("@article{vaswani2017attention,");
    expect(pane(app, "preview")).toContain("Attention Is All You Need");
    expect(pane(app, "preview")).toContain("year = {2017}");
  });

  it("highlights the active tab in the tab bar", () => {
    expect(pane(app, "preview")).toContain("Info  Abstract  Notes  BibTeX");
    const rect = deriveLayout(120, 30, "papers").preview!;
    const screen = app.frame().screen;
    const row = screen.rowText(rect.y);
    const info = row.indexOf("Info");
    const abstract = row.indexOf("Abstract");
    expect(screen.styleAt(info, rect.y)).toEqual(theme.tabActive);
    expect(screen.styleAt(abstract, rect.y)).toEqual(theme.tabInactive);
  });

  it("shows highlights from the sidecar on the Notes tab, with the PDF's line breaks collapsed", async () => {
    await writeSidecar(root, ATTENTION, [
      highlight(ATTENTION, 1, "The dominant sequence\ntransduction mod-\nels are based on complex recurrent"),
      highlight(ATTENTION, 2, "Compare with the RNN baseline", { type: "note" }),
    ]);
    await ctx.store.reload();
    press(app, "tab", "tab");
    await eventually(() => pane(app, "preview").includes("p. 1"), "the sidecar to load", app);
    const preview = pane(app, "preview");
    expect(preview).toContain("▌ The dominant sequence transduction");
    expect(preview).toContain("models are based on complex recurrent");
    expect(preview).not.toContain("mod-");
    expect(preview).toContain("p. 2");
    expect(preview).toContain("Compare with the RNN baseline");
    expect(preview).toContain("Notes 2");
  });

  it("says so on the Notes tab when a paper has no highlights", () => {
    press(app, "tab", "tab");
    expect(pane(app, "preview")).toContain("No highlights or notes yet.");
  });

  it("counts the highlights on the Info tab once the sidecar is loaded", async () => {
    await writeSidecar(root, ATTENTION, [highlight(ATTENTION, 1, "one"), highlight(ATTENTION, 2, "two")]);
    await ctx.store.reload();
    await eventually(() => pane(app, "preview").includes("2 highlights"), "the sidecar to load", app);
    expect(pane(app, "preview")).toContain("Notes  2 highlights — Tab to read");
  });
});
