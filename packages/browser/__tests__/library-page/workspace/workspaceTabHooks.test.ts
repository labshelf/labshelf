/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// A tab body marks its tab dirty and can veto its close; the workspace keeps focus where it was.
import type { ILogger } from "@labshelf/core";
import type { TabContext } from "../../../src/library-page/tabs";
import { createWorkspace, type Workspace } from "../../../src/library-page/workspace";
import { planPage } from "../../../src/library-page/sections";

const captured: TabContext[] = [];
jest.mock("../../../src/library-page/tabs/templates/index", () => ({
  mountTab: (_host: HTMLElement, _params: unknown, ctx: TabContext) => { captured.push(ctx); return { dispose: jest.fn(), actions: [{ id: "x", icon: "bold", label: "Do x", run: jest.fn() }] }; },
}));

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const storage = { getItem: () => null, setItem: () => undefined };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(): Promise<{ workspace: Workspace; ctx: TabContext }> {
  captured.length = 0;
  const workspace = createWorkspace(document.body.appendChild(document.createElement("div")), {
    prefs: { load: () => null, save: () => undefined }, logger, plan: planPage({ library: true, projects: true }), storage,
    services: () => ({ libraryView: document.createElement("div"), logger, fs: {} as never, prefs: {} as never, selection: {} as never, project: () => ({}) as never }),
  });
  workspace.openTab("templates");
  await tick();
  return { workspace, ctx: captured[0]! };
}

const templates = (workspace: Workspace) => workspace.tabs().find((t) => t.id === "templates")!;

describe("workspace tab hooks", () => {
  it("shows the actions of a lazily loaded body in the tab strip toolbar", async () => {
    const { workspace } = await setup();
    const bar = document.querySelector<HTMLElement>(".ls-editor-actions")!;
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector("button")?.getAttribute("aria-label")).toBe("Do x");
    workspace.dispose();
  });

  it("shows the dirty mark a body sets and clears it", async () => {
    const { workspace, ctx } = await setup();
    ctx.tab.setDirty(true);
    expect(templates(workspace).dirty).toBe(true);
    ctx.tab.setDirty(false);
    expect(templates(workspace).dirty).toBe(false);
    workspace.dispose();
  });

  it("keeps the dirty mark when the tab is opened again, and keeps another tab focused", async () => {
    const { workspace, ctx } = await setup();
    ctx.tab.setDirty(true);
    workspace.openTab("all-projects");
    ctx.tab.setDirty(false);
    ctx.tab.setDirty(true);
    expect(workspace.tabs().find((t) => t.focused)?.id).toBe("all-projects");
    workspace.openTab("templates");
    expect(templates(workspace).dirty).toBe(true);
    workspace.dispose();
  });

  it("keeps the tab open when its before-close handler resolves false", async () => {
    const { workspace, ctx } = await setup();
    ctx.tab.onBeforeClose(async () => false);
    expect(await workspace.closeTabs((id) => id === "templates")).toBe(false);
    expect(workspace.tabs().map((t) => t.id)).toContain("templates");
    workspace.dispose();
  });

  it("keeps the tab open when the handler throws, and closes it once the handler allows", async () => {
    const { workspace, ctx } = await setup();
    ctx.tab.onBeforeClose(() => { throw new Error("write failed"); });
    expect(await workspace.closeTabs((id) => id === "templates")).toBe(false);
    expect(logger.error).toHaveBeenCalled();
    ctx.tab.onBeforeClose(async () => true);
    expect(await workspace.closeTabs((id) => id === "templates")).toBe(true);
    expect(workspace.tabs().map((t) => t.id)).not.toContain("templates");
    workspace.dispose();
  });

  it("warns before the page unloads while a tab is dirty", async () => {
    const { workspace, ctx } = await setup();
    const event = () => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(event()).toBe(false);
    ctx.tab.setDirty(true);
    expect(event()).toBe(true);
    workspace.dispose();
  });
});
