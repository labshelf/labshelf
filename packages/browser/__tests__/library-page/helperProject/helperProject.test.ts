// Pins the page's helper project: lazy connect, opening the session's project, edits feeding builds, problems per file.
import type { ILogger, ProjectEntry } from "@labshelf/core";
import type { HelperCompileRequest, HelperCompileResult, HelperStatus, ILatexHelper } from "@labshelf/core/helper";
import { createHelperProject, type BuildEvent } from "../../../src/library-page/helperProject";

const logger: ILogger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
const READY: HelperStatus = { state: "ready", helperVersion: "1", tex: { source: "none", complete: false }, host: "helper" };
const project = (id: string): ProjectEntry => ({
  kind: "ready", folder: `projects/${id}`, location: "library", main: "main.tex", settings: { id, format: "latex" },
});
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function fakeHelper(answer: HelperStatus) {
  let current: HelperStatus | undefined;
  const calls: string[] = [];
  const compiles: HelperCompileRequest[] = [];
  let result: HelperCompileResult = { status: "succeeded", problems: [], pageCount: 1, changed: [] };
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
    const fake = fakeHelper(READY);
    const hp = createHelperProject({ helper: fake.helper, logger, timers: { setTimeout: () => 0, clearTimeout: () => undefined } });
    await hp.projectChanged(project("a"));
    const events: BuildEvent["type"][] = [];
    hp.onBuild((event) => events.push(event.type));
    const port = hp.editorPort("a");
    await port.edit("a", "main.tex", 1, { text: "x" });
    await port.save("a", "main.tex");
    await flush();
    expect(fake.calls.slice(2)).toEqual(["edit a main.tex 1", "save a main.tex", "compile full"]);
    expect(events).toEqual(["building", "building", "result"]);
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
});
