// Tests space.evalMath: the guard that admits it and serveSpaces answering space.mathResult with the requestId and the runner's result on the Space note's session.
import { createLoopbackTransport } from "../../src/libraryUi/protocol/index";
import type { ILogger } from "../../src/ports/index";
import { parseSpacesMessage, serveSpaces, type HostToSpaces, type SpacesHostPort, type SpacesToHost } from "../../src/spaces/index";
import { seededFixture } from "./store/spaceStoreFixture";
import { library } from "./viewModel/viewFixture";

const base = { version: 1, name: "Thesis", folders: [], papers: [{ id: "p1" }], projects: [], dates: [] };
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const RESULT = { state: "value", latex: "\\frac{1}{2}", readAs: "Integrate[x, {x, 0, 1}]", rewrites: [], messages: [] };
const eval_ = { type: "space.evalMath", path: "notes/calc.qmd", itemId: "n1", requestId: "m1", op: "eval", tex: "\\int_0^1 x\\,dx" };

async function setup(runMath?: (request: never, signal?: AbortSignal) => Promise<unknown>) {
  const f = await seededFixture({ thesis: base });
  await f.store.reload();
  const path = await f.store.notes.create("thesis", "Calc");
  const itemId = await f.store.notes.addItem("thesis", path, "text\n");
  const port: SpacesHostPort = {
    library: () => library({ id: "p1", title: "Attention", status: "done" }),
    onLibraryChange: () => () => undefined,
    projects: async () => [],
    onProjectsChange: () => () => undefined,
    openPaper: async () => undefined, selectPaper: async () => undefined, openProject: async () => undefined,
    openSpace: async () => undefined, openCatalog: async () => undefined, saveFile: async () => undefined,
  };
  const { ui, host } = createLoopbackTransport<SpacesToHost, HostToSpaces>();
  const posted: HostToSpaces[] = [];
  ui.subscribe((message) => posted.push(message));
  const logger: ILogger = { log: async () => undefined, error: async () => undefined };
  serveSpaces(host, { store: f.store, port, logger, today: () => "2026-11-01", ...(runMath ? { runMath } : {}) } as never);
  ui.post({ type: "ready", view: "space", id: "thesis" });
  await settle();
  posted.length = 0;
  return { ui, posted, path, itemId };
}

describe("space.evalMath guard", () => {
  it("2.3a accepts a valid space.evalMath", () => { expect(parseSpacesMessage(eval_)).toEqual(eval_); });

  it.each(["eval", "numeric", "solve", "check"])("2.3a accepts op %s", (op) => {
    expect(parseSpacesMessage({ ...eval_, op })).toEqual({ ...eval_, op });
  });

  it("2.3a drops a space.evalMath with an unknown op", () => { expect(parseSpacesMessage({ ...eval_, op: "simplify" })).toBeUndefined(); });

  it.each(["path", "itemId", "requestId", "op", "tex"])("2.3a drops space.evalMath without %s", (field) => {
    const { [field]: _omitted, ...rest } = eval_ as Record<string, unknown>;
    expect(parseSpacesMessage(rest)).toBeUndefined();
  });

  it.each(["path", "itemId", "requestId", "tex"])("2.3a drops space.evalMath with an empty %s", (field) => {
    expect(parseSpacesMessage({ ...eval_, [field]: "" })).toBeUndefined();
  });
});

describe("serveSpaces space.evalMath", () => {
  it("2.3a posts space.mathResult with the requestId and the runner's result", async () => {
    const { ui, posted, path, itemId } = await setup(async () => RESULT);
    ui.post({ type: "space.evalMath", path, itemId, requestId: "m1", op: "eval", tex: "\\int_0^1 x\\,dx" } as never);
    await settle();
    expect(posted.filter((m) => (m.type as string) === "space.mathResult")).toEqual([{ type: "space.mathResult", requestId: "m1", result: RESULT }]);
  });

  it("A4 runs the request on the Space note's session with its op and tex", async () => {
    const requests: unknown[] = [];
    const { ui, path, itemId } = await setup(async (request) => { requests.push(request); return RESULT; });
    ui.post({ type: "space.evalMath", path, itemId, requestId: "m1", op: "numeric", tex: "\\pi" } as never);
    await settle();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(expect.objectContaining({ noteKey: `space:thesis:${path}`, op: "numeric", tex: "\\pi" }));
  });

  it("2.3a answers each request with its own requestId", async () => {
    const { ui, posted, path, itemId } = await setup(async (request) => ({ ...RESULT, readAs: (request as { tex: string }).tex }));
    ui.post({ type: "space.evalMath", path, itemId, requestId: "m1", op: "eval", tex: "a" } as never);
    ui.post({ type: "space.evalMath", path, itemId, requestId: "m2", op: "eval", tex: "b" } as never);
    await settle();
    const replies = posted.filter((m) => (m.type as string) === "space.mathResult");
    expect(replies).toContainEqual({ type: "space.mathResult", requestId: "m1", result: { ...RESULT, readAs: "a" } });
    expect(replies).toContainEqual({ type: "space.mathResult", requestId: "m2", result: { ...RESULT, readAs: "b" } });
  });
});
