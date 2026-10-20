// Pins the page's helper project: lazy connect, opening the session's project, edits feeding builds, problems per file.
import { PDFDocument } from "pdf-lib";
import type { ILogger, ProjectEntry } from "@labshelf/core";
import type { HelperCompileRequest, HelperCompileResult, HelperStatus, ILatexHelper } from "@labshelf/core/helper";
import { createHelperProject, type BuildEvent } from "../../../src/library-page/helperProject";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const READY: HelperStatus = { state: "ready", helperVersion: "1", tex: { source: "none", complete: false }, host: "helper" };
const project = (id: string): ProjectEntry => ({
  kind: "ready", folder: `projects/${id}`, location: "library", main: "main.tex", settings: { id, format: "latex" },
});
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)); };

async function succeededWith(width: number): Promise<HelperCompileResult> {
  const doc = await PDFDocument.create();
  doc.addPage([width, 100]);
  return { status: "succeeded", problems: [], pageCount: 1, changed: [{ index: 0, bytes: await doc.save() }] };
}
async function widthOf(bytes: Uint8Array | undefined): Promise<number | undefined> {
  return bytes ? (await PDFDocument.load(bytes)).getPage(0).getWidth() : undefined;
}

function fakeHelper(answer: HelperStatus, initial?: HelperCompileResult) {
  let current: HelperStatus | undefined;
  const calls: string[] = [];
  const compiles: HelperCompileRequest[] = [];
  let result: HelperCompileResult = initial ?? { status: "succeeded", problems: [], pageCount: 0, changed: [] };
  const helper = {
    connect: jest.fn(async () => { current = answer; calls.push("connect"); return answer; }),
    status: () => current,
    openProject: jest.fn(async (id: string, root: string) => { calls.push(`open ${id} ${root}`); return { files: [] }; }),
    closeProject: jest.fn(async (id: string) => { calls.push(`close ${id}`); }),
    edit: jest.fn(async (id: string, path: string, version: number) => { calls.push(`edit ${id} ${path} ${version}`); }),
    save: jest.fn(async (id: string, path: string) => { calls.push(`save ${id} ${path}`); }),
    compile: jest.fn(async (req: HelperCompileRequest) => { compiles.push(req); calls.push(`compile ${req.mode}`); return result; }),
    cancel: jest.fn(async () => undefined),
  } as unknown as ILatexHelper;
  return { helper, calls, compiles, setAnswer: (s: HelperStatus) => { answer = s; }, setResult: (r: HelperCompileResult) => { result = r; } };
}

const instantTimers = { setTimeout: (fn: () => void) => { fn(); return 0; }, clearTimeout: () => undefined };

describe("createHelperProject", () => {
  it("connects on the first project open and opens the project folder in the helper", async () => {
    const fake = fakeHelper(READY);
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    const opened: string[] = [];
    hp.onOpened((id) => opened.push(id));
    await hp.projectChanged(project("a"));
    expect(fake.calls).toEqual(["connect", "open a projects/a"]);
    expect(hp.isOpen("a")).toBe(true);
    expect(hp.helper()).toBe(fake.helper);
    expect(opened).toEqual(["a"]);
  });

  it("works without a helper and opens the project once the setup card connects", async () => {
    const fake = fakeHelper({ state: "not-installed" });
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    await hp.projectChanged(project("a"));
    expect(hp.status()).toEqual({ state: "not-installed" });
    expect(hp.helper()).toBeUndefined();
    expect(hp.editorPort("a").status()).toBeUndefined();
    fake.setAnswer(READY);
    await hp.setupHelper.connect();
    expect(fake.calls).toEqual(["connect", "connect", "open a projects/a"]);
    expect(hp.editorPort("a").status()).toEqual(READY);
  });

  it("forwards edits and schedules a preview build; a save asks for a full build after the helper heard it", async () => {
    const fake = fakeHelper(READY, await succeededWith(101));
    const hp = createHelperProject({ helper: fake.helper, logger, timers: { setTimeout: () => 0, clearTimeout: () => undefined } });
    await hp.projectChanged(project("a"));
    const events: BuildEvent["type"][] = [];
    hp.onBuild((event) => events.push(event.type));
    const port = hp.editorPort("a");
    await port.edit("a", "main.tex", 1, { text: "x" });
    await port.save("a", "main.tex");
    await flush();
    expect(fake.calls.slice(2)).toEqual(["edit a main.tex 1", "save a main.tex", "compile full"]);
    expect(events).toEqual(["building", "pdf", "result"]);
  });

  it("passes the line of an edit to the preview build", async () => {
    const fake = fakeHelper(READY);
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    await hp.projectChanged(project("a"));
    await hp.editorPort("a").edit("a", "ch/a.tex", 1, { text: "x" }, 9);
    await flush();
    expect(fake.compiles[0]).toMatchObject({ mode: "preview", editedFile: "ch/a.tex", editedLine: 9 });
    expect(fake.helper.edit).toHaveBeenCalledWith("a", "ch/a.tex", 1, { text: "x" });
  });

  it("publishes the build's problems per file, clearing files without any", async () => {
    const fake = fakeHelper(READY);
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    await hp.projectChanged(project("a"));
    const main: number[] = [];
    const intro: number[] = [];
    hp.problems.subscribe("main.tex", (problems) => main.push(problems.length));
    hp.problems.subscribe("intro.tex", (problems) => intro.push(problems.length));
    fake.setResult({ status: "failed", changed: [], problems: [
      { severity: "error", message: "Undefined control sequence", file: "main.tex", line: 3 },
      { severity: "warning", message: "Overfull", file: "main.tex", line: 9 },
    ] });
    hp.build("a");
    await flush();
    expect(main).toEqual([0, 2]);
    expect(intro).toEqual([0, 0]);
  });

  it("closes the project in the helper when the session closes it", async () => {
    const fake = fakeHelper(READY);
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    await hp.projectChanged(project("a"));
    await hp.projectChanged(undefined);
    expect(fake.calls).toEqual(["connect", "open a projects/a", "close a"]);
    expect(hp.isOpen("a")).toBe(false);
    hp.build("a");
    expect(fake.compiles).toEqual([]);
  });

  it("keeps the project open in the helper when the session reports it again while it is still opening", async () => {
    const fake = fakeHelper(READY);
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    await hp.connect();
    await Promise.all([hp.projectChanged(project("a")), hp.projectChanged(project("a"))]);
    expect(fake.calls).toEqual(["connect", "open a projects/a"]);
    expect(hp.isOpen("a")).toBe(true);
  });

  it("closes a project the session left while it was opening, and opens the one it went to", async () => {
    const fake = fakeHelper(READY);
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    await hp.connect();
    await Promise.all([hp.projectChanged(project("a")), hp.projectChanged(project("b"))]);
    expect(fake.calls).toEqual(["connect", "open a projects/a", "open b projects/b", "close a"]);
    expect(hp.isOpen("b")).toBe(true);
  });

  it("keeps the PDF of the latest full build only, and forgets it when the project closes", async () => {
    const fake = fakeHelper(READY, await succeededWith(101));
    const pending: Array<{ fn: () => void; ms: number }> = [];
    const timers = { setTimeout: (fn: () => void, ms: number) => { pending.push({ fn, ms }); return pending.length; }, clearTimeout: () => undefined };
    const hp = createHelperProject({ helper: fake.helper, logger, timers });
    await hp.projectChanged(project("a"));
    await hp.editorPort("a").edit("a", "main.tex", 1, { text: "x" });
    pending.splice(0).filter(({ ms }) => ms === 500).forEach(({ fn }) => fn());
    await flush();
    expect(fake.compiles.map((req) => req.mode)).toEqual(["preview"]);
    expect(hp.lastFullPdf("a")).toBeUndefined();
    await hp.build("a");
    await flush();
    expect(await widthOf(hp.lastFullPdf("a"))).toBe(101);
    fake.setResult(await succeededWith(202));
    await hp.editorPort("a").edit("a", "main.tex", 2, { text: "y" });
    pending.splice(0).filter(({ ms }) => ms === 500).forEach(({ fn }) => fn());
    await flush();
    expect(fake.compiles.map((req) => req.mode)).toEqual(["preview", "full", "preview"]);
    expect(await widthOf(hp.lastFullPdf("a"))).toBe(101);
    await hp.projectChanged(undefined);
    expect(hp.lastFullPdf("a")).toBeUndefined();
  });

  it("sends the assembled PDF before the build's result", async () => {
    const fake = fakeHelper(READY, await succeededWith(101));
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    await hp.projectChanged(project("a"));
    const events: BuildEvent[] = [];
    hp.onBuild((event) => events.push(event));
    await hp.build("a");
    await flush();
    expect(events.map((event) => event.type)).toEqual(["building", "pdf", "result"]);
    const pdf = events[1];
    expect(pdf?.type === "pdf" ? pdf.mode : undefined).toBe("full");
    expect(pdf?.type === "pdf" ? await widthOf(pdf.bytes) : undefined).toBe(101);
  });

  it("reports a failed result and logs when a succeeded build cannot be assembled", async () => {
    const fake = fakeHelper(READY, { status: "succeeded", problems: [], pageCount: 2, changed: [] });
    const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
    await hp.projectChanged(project("a"));
    const events: BuildEvent[] = [];
    hp.onBuild((event) => events.push(event));
    await hp.build("a");
    await flush();
    expect(events.map((event) => event.type)).toEqual(["building", "result"]);
    const last = events[1];
    expect(last?.type === "result" ? last.result.status : undefined).toBe("failed");
    expect(logger.error).toHaveBeenCalled();
    expect(hp.lastFullPdf("a")).toBeUndefined();
  });
});


it("retains the displayed PDF when a full build reports no changed pages", async () => {
  const fake = fakeHelper(READY, await succeededWith(101));
  const hp = createHelperProject({ helper: fake.helper, logger, timers: instantTimers });
  await hp.projectChanged(project("a"));
  const events: BuildEvent[] = [];
  hp.onBuild((event) => events.push(event));
  await hp.build("a");
  await flush();
  const first = hp.lastFullPdf("a");
  fake.setResult({ status: "succeeded", pageCount: 1, changed: [], problems: [] });
  await hp.build("a");
  await flush();
  expect(events.filter((event) => event.type === "pdf")).toHaveLength(1);
  expect(events.filter((event) => event.type === "result")).toHaveLength(2);
  expect(hp.lastFullPdf("a")).toBe(first);
});
