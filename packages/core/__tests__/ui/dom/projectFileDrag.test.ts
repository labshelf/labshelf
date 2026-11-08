/** @jest-environment jsdom */
// Spec 7.3: the shared file-drop reading of ui/dom/projectFileDrag.ts: the LabShelf project-file payload round trip, uri lists with comments,
// and which drag types a file drop target accepts. Acceptance ids: 7.3a, 7.3c.
import {
  PROJECT_FILE_DRAG_MIME, acceptsFileDrop, attachFileDrop, parseProjectFileDragPayload, projectFileDragPayload, readFileDrop, startProjectFileDrag,
} from "../../../src/ui/dom/projectFileDrag";

const transfer = (data: Record<string, string>): Pick<DataTransfer, "getData" | "types"> & { set: Record<string, string>; dropEffect: string; effectAllowed: string; setData(type: string, value: string): void } => {
  const set: Record<string, string> = {};
  return { types: Object.keys(data), getData: (type: string) => data[type] ?? "", set, dropEffect: "none", effectAllowed: "all", setData: (type, value) => { set[type] = value; } };
};
const dragEvent = (type: string, data: Record<string, string>): MouseEvent => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: transfer(data) });
  return event;
};

describe("project file payload", () => {
  it("7.3a round-trips a project file and keeps only well-formed entries", () => {
    const raw = projectFileDragPayload({ projectId: "p1", path: "figures/a.png" });
    expect(parseProjectFileDragPayload(raw)).toEqual([{ projectId: "p1", path: "figures/a.png" }]);
    expect(parseProjectFileDragPayload(JSON.stringify([{ projectId: "p", path: "a.png" }, { path: "b.png" }, 3]))).toEqual([{ projectId: "p", path: "a.png" }]);
    expect(parseProjectFileDragPayload("not json")).toEqual([]);
  });

  it("7.3a startProjectFileDrag sets the payload and the path as plain text", () => {
    const event = dragEvent("dragstart", {});
    startProjectFileDrag(event as DragEvent, { projectId: "p1", path: "a.png" });
    const set = (event as unknown as { dataTransfer: { set: Record<string, string> } }).dataTransfer.set;
    expect(parseProjectFileDragPayload(set[PROJECT_FILE_DRAG_MIME]!)).toEqual([{ projectId: "p1", path: "a.png" }]);
    expect(set["text/plain"]).toBe("a.png");
  });
});

describe("readFileDrop", () => {
  it("7.3a reads the uris of a uri list, skipping blank lines and comments, and the project files", () => {
    const drop = readFileDrop(transfer({
      "text/uri-list": "# from the Explorer\r\nfile:///proj/a.png\r\n\r\nfile:///proj/b.svg\r\n",
      [PROJECT_FILE_DRAG_MIME]: projectFileDragPayload({ projectId: "p", path: "c.png" }),
    }));
    expect(drop).toEqual({ uris: ["file:///proj/a.png", "file:///proj/b.svg"], files: [{ projectId: "p", path: "c.png" }] });
  });

  it("7.3a prefers VS Code's uri list type", () => {
    expect(readFileDrop(transfer({ "application/vnd.code.uri-list": "file:///x.png", "text/uri-list": "file:///y.png" })).uris).toEqual(["file:///x.png"]);
  });
});

describe("accepting a file drop", () => {
  it("7.3c accepts a project file or a uri list, not plain text", () => {
    expect(acceptsFileDrop([PROJECT_FILE_DRAG_MIME])).toBe(true);
    expect(acceptsFileDrop(["text/uri-list"])).toBe(true);
    expect(acceptsFileDrop(["application/vnd.code.uri-list"])).toBe(true);
    expect(acceptsFileDrop(["text/plain"])).toBe(false);
    expect(acceptsFileDrop(undefined)).toBe(false);
  });

  it("7.3c attachFileDrop prevents the default only for files and hands the drop over", () => {
    const el = document.createElement("div");
    const drops: unknown[] = [];
    attachFileDrop(el, (drop) => drops.push(drop));
    const text = dragEvent("dragover", { "text/plain": "hello" });
    el.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
    const files = dragEvent("dragover", { "text/uri-list": "file:///a.png" });
    el.dispatchEvent(files);
    expect(files.defaultPrevented).toBe(true);
    expect(el.classList.contains("is-drop-target")).toBe(true);
    el.dispatchEvent(dragEvent("drop", { "text/uri-list": "file:///a.png" }));
    expect(drops).toEqual([{ uris: ["file:///a.png"], files: [] }]);
    expect(el.classList.contains("is-drop-target")).toBe(false);
  });

  it("7.3c without a handler nothing is accepted", () => {
    const el = document.createElement("div");
    attachFileDrop(el, undefined);
    const files = dragEvent("dragover", { "text/uri-list": "file:///a.png" });
    el.dispatchEvent(files);
    expect(files.defaultPrevented).toBe(false);
  });
});
