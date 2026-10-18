// Tests that the host side of the All projects page posts rows after ready and runs its actions.
import {
  serveAllProjects, type AllProjectsToHost, type HostToAllProjects, type ProjectLibraryPort, type ProjectDetail, type ProjectRow,
} from "../../../src/writing/allProjects/index";
import type { ILogger } from "../../../src/ports/index";

const rows: ProjectRow[] = [
  { id: "a", title: "A", place: "projects" },
  { id: "t1", title: "T1", place: "trash" },
  { id: "t2", title: "T2", place: "trash" },
];

const detail: ProjectDetail = {
  id: "a", location: "/p/a", limits: { countUpTo: "end" }, build: { state: "never", warnings: 0, errors: 0 },
  citations: [], versions: [], sources: ["main.tex"],
};

function setup() {
  const posted: HostToAllProjects[] = [];
  let handler: (message: AllProjectsToHost) => void = () => undefined;
  let changed: () => void = () => undefined;
  const stops = { messages: jest.fn(), changes: jest.fn() };
  const port = {
    list: jest.fn(async () => rows),
    onDidChange: jest.fn((listener: () => void) => { changed = listener; return stops.changes; }),
    commands: jest.fn(() => []),
    newKinds: jest.fn(() => (["blank"])),
    rename: jest.fn(async () => undefined),
    deleteForever: jest.fn(async () => undefined),
    files: jest.fn(async () => ["main.tex", "sec/intro.tex"]),
    openFile: jest.fn(async () => undefined),
    detail: jest.fn(async (id: string) => ({ ...detail, id })),
    build: jest.fn(async () => undefined),
    preview: jest.fn(async () => undefined),
    openLog: jest.fn(async () => undefined),
    createFile: jest.fn(async () => undefined),
    setTarget: jest.fn(async () => undefined),
    openLabel: jest.fn(() => "Open in VS Code"),
  } as unknown as ProjectLibraryPort;
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;
  const endpoint = {
    post: (message: HostToAllProjects) => { posted.push(message); },
    subscribe: (h: (message: AllProjectsToHost) => void) => { handler = h; return stops.messages; },
  };
  const dispose = serveAllProjects(endpoint, port, logger);
  return { posted, port, logger, dispose, stops, send: (m: AllProjectsToHost) => handler(m), change: () => changed() };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("serveAllProjects", () => {
  it("posts rows only after ready, and again on every change", async () => {
    const { posted, send, change } = setup();
    change();
    await flush();
    expect(posted).toEqual([]);
    send({ type: "ready" });
    await flush();
    change();
    await flush();
    expect(posted).toEqual([{ type: "projects", rows, commands: [], newKinds: ["blank"], openLabel: "Open in VS Code" }, { type: "projects", rows, commands: [], newKinds: ["blank"], openLabel: "Open in VS Code" }]);
  });

  it("dispatches an action to the port", async () => {
    const { port, send } = setup();
    send({ type: "rename", id: "a", title: "B" });
    await flush();
    expect(port.rename).toHaveBeenCalledWith("a", "B");
  });

  it("logs and posts an error when an action rejects", async () => {
    const { port, logger, posted, send } = setup();
    (port.rename as jest.Mock).mockRejectedValueOnce(new Error("disk full"));
    send({ type: "rename", id: "a", title: "B" });
    await flush();
    expect(posted).toEqual([{ type: "error", message: "Rename failed: disk full" }]);
    expect(logger.log).toHaveBeenCalledWith("ERROR", "allProjects", "Rename failed", { type: "rename", id: "a", error: "disk full" });
  });

  it("posts the file listing a page asks for", async () => {
    const { posted, send } = setup();
    send({ type: "files", id: "a" });
    await flush();
    expect(posted).toEqual([{ type: "files", id: "a", files: ["main.tex", "sec/intro.tex"] }]);
  });

  it("logs a failed listing and posts it as the listing's error, not as a toast", async () => {
    const { port, logger, posted, send } = setup();
    (port.files as jest.Mock).mockRejectedValueOnce(new Error("gone"));
    send({ type: "files", id: "a" });
    await flush();
    expect(posted).toEqual([{ type: "files", id: "a", error: "gone" }]);
    expect(logger.log).toHaveBeenCalledWith("ERROR", "allProjects", "List files failed", { type: "files", id: "a", error: "gone" });
  });

  it("opens a project file and reports a failure as Open file", async () => {
    const { port, posted, send } = setup();
    send({ type: "openFile", id: "a", path: "sec/intro.tex" });
    await flush();
    expect(port.openFile).toHaveBeenCalledWith("a", "sec/intro.tex");
    (port.openFile as jest.Mock).mockRejectedValueOnce(new Error("no editor"));
    send({ type: "openFile", id: "a", path: "main.tex" });
    await flush();
    expect(posted).toEqual([{ type: "error", message: "Open file failed: no editor" }]);
  });

  it("empties the trash by deleting every trashed row of a fresh list", async () => {
    const { port, send } = setup();
    send({ type: "emptyTrash" });
    await flush();
    expect((port.deleteForever as jest.Mock).mock.calls).toEqual([["t1"], ["t2"]]);
  });

  it("posts the detail a page asks for", async () => {
    const { posted, send } = setup();
    send({ type: "detail", id: "a" });
    await flush();
    expect(posted).toEqual([{ type: "detail", id: "a", detail }]);
  });

  it("logs a failed detail and posts it as the detail's error, not as a toast", async () => {
    const { port, logger, posted, send } = setup();
    (port.detail as jest.Mock).mockRejectedValueOnce(new Error("unreadable"));
    send({ type: "detail", id: "a" });
    await flush();
    expect(posted).toEqual([{ type: "detail", id: "a", error: "unreadable" }]);
    expect(logger.log).toHaveBeenCalledWith("ERROR", "allProjects", "Load detail failed", { type: "detail", id: "a", error: "unreadable" });
  });

  it("dispatches build, preview, openLog and createFile to the port", async () => {
    const { port, send } = setup();
    send({ type: "build", id: "a" });
    send({ type: "preview", id: "a" });
    send({ type: "openLog", id: "a" });
    send({ type: "createFile", id: "a", path: "refs.bib" });
    await flush();
    expect(port.build).toHaveBeenCalledWith("a");
    expect(port.preview).toHaveBeenCalledWith("a");
    expect(port.openLog).toHaveBeenCalledWith("a");
    expect(port.createFile).toHaveBeenCalledWith("a", "refs.bib");
  });

  it("reports a failed build as Build failed", async () => {
    const { port, posted, send } = setup();
    (port.build as jest.Mock).mockRejectedValueOnce(new Error("no engine"));
    send({ type: "build", id: "a" });
    await flush();
    expect(posted).toEqual([{ type: "error", message: "Build failed: no engine" }]);
  });

  it("maps setTarget to a target, and to null when both fields are absent", async () => {
    const { port, send } = setup();
    send({ type: "setTarget", id: "a", venue: "ICML", deadline: "2027-02-28" });
    send({ type: "setTarget", id: "a", venue: "ICML" });
    send({ type: "setTarget", id: "a" });
    await flush();
    expect((port.setTarget as jest.Mock).mock.calls).toEqual([
      ["a", { venue: "ICML", deadline: "2027-02-28" }], ["a", { venue: "ICML" }], ["a", null],
    ]);
  });

  it("stops listening on dispose", () => {
    const { dispose, stops } = setup();
    dispose();
    expect(stops.messages).toHaveBeenCalled();
    expect(stops.changes).toHaveBeenCalled();
  });
});
