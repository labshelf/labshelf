import * as path from "node:path";
import { pathToFileURL } from "node:url";

import { fileUrisToPage, pageUrisToFiles, rootInitialize, UriRefusedError } from "../../../../../src/writing/helper/node/lsp/uriMapping.js";

const root = path.join(path.sep, "data", "projects", "p1", "src");
const fileUri = (relative: string) => pathToFileURL(path.join(root, relative)).href;

describe("page to file URIs", () => {
  it("maps a percent-encoded page URI to the working copy file, at any depth", () => {
    const mapped = pageUrisToFiles({ params: { list: [{ uri: "labshelf:/a%20b.typ" }, { uri: "labshelf:/dir/c.typ" }], n: 3 } }, root);
    expect(mapped).toEqual({ params: { list: [{ uri: fileUri("a b.typ") }, { uri: fileUri("dir/c.typ") }], n: 3 } });
    expect(fileUri("a b.typ")).toContain("a%20b.typ");
  });

  it("refuses parent-directory and absolute paths", () => {
    expect(() => pageUrisToFiles({ uri: "labshelf:/../x.typ" }, root)).toThrow(UriRefusedError);
    expect(() => pageUrisToFiles({ uri: "labshelf:/a/%2E%2E/%2E%2E/x.typ" }, root)).toThrow(UriRefusedError);
    expect(() => pageUrisToFiles({ uri: "labshelf:/%2Fetc%2Fpasswd" }, root)).toThrow(UriRefusedError);
    expect(() => pageUrisToFiles({ uri: "labshelf:/%E0%A4%A" }, root)).toThrow(UriRefusedError);
  });

  it("refuses any raw file: string, in any case, as a value or a key", () => {
    expect(() => pageUrisToFiles({ params: { textDocument: { uri: "file:///etc/passwd" } } }, root)).toThrow(UriRefusedError);
    expect(() => pageUrisToFiles({ params: { event: { added: [{ uri: "FILE:///etc" }] } } }, root)).toThrow(UriRefusedError);
    expect(() => pageUrisToFiles({ changes: { "File:/x": [] } }, root)).toThrow(UriRefusedError);
  });
});

describe("file to page URIs", () => {
  it("maps working copy files back, encoding each segment", () => {
    const { payload, outside } = fileUrisToPage({ result: [{ uri: fileUri("a b.typ") }, { uri: fileUri("d/é.typ") }] }, root);
    expect(payload).toEqual({ result: [{ uri: "labshelf:/a%20b.typ" }, { uri: "labshelf:/d/%C3%A9.typ" }] });
    expect(outside).toEqual([]);
  });

  it("nulls a URI outside the working copy and lists it", () => {
    const outsideUri = pathToFileURL(path.join(path.sep, "etc", "passwd")).href;
    const { payload, outside } = fileUrisToPage({ result: { uri: outsideUri, other: "text" } }, root);
    expect(payload).toEqual({ result: { uri: null, other: "text" } });
    expect(outside).toEqual([outsideUri]);
  });
});

describe("URIs as object keys", () => {
  it("maps keys in both directions, as in a WorkspaceEdit's changes", () => {
    expect(pageUrisToFiles({ changes: { "labshelf:/a.typ": [] } }, root)).toEqual({ changes: { [fileUri("a.typ")]: [] } });
    expect(fileUrisToPage({ changes: { [fileUri("a.typ")]: [] } }, root).payload).toEqual({ changes: { "labshelf:/a.typ": [] } });
  });

  it("lists a key outside the working copy and omits it", () => {
    const outsideUri = pathToFileURL(path.join(path.sep, "etc", "hosts")).href;
    const { payload, outside } = fileUrisToPage({ changes: { [outsideUri]: [] } }, root);
    expect(payload).toEqual({ changes: {} });
    expect(outside).toEqual([outsideUri]);
  });
});

describe("rootInitialize", () => {
  it("points rootUri and workspaceFolders at the working copy", () => {
    const out = rootInitialize({ method: "initialize", id: 1, params: { rootUri: "file:///home/x", rootPath: "/home/x", workspaceFolders: [{ uri: "file:///home/x", name: "x" }], capabilities: {} } }, root);
    const params = out.params as Record<string, unknown>;
    expect(params.rootUri).toBe(fileUri(""));
    expect(params.workspaceFolders).toEqual([{ uri: fileUri(""), name: "project" }]);
    expect(params.rootPath).toBeUndefined();
    expect(params.capabilities).toEqual({});
  });

  it("replaces the page's initializationOptions with an empty object", () => {
    const out = rootInitialize({ method: "initialize", id: 1, params: { initializationOptions: { rootPath: "/", typstExtraArgs: ["--root", "/"] } } }, root);
    expect((out.params as Record<string, unknown>).initializationOptions).toEqual({});
  });

  it("leaves other messages untouched", () => {
    const message = { method: "textDocument/didOpen", params: { rootUri: "x" } };
    expect(rootInitialize(message, root)).toBe(message);
  });
});

describe("document text", () => {
  it("passes text and newText that begin with file: unchanged", () => {
    const payload = { textDocument: { uri: "labshelf:/a.typ", text: "file: notes" }, edits: [{ newText: "file:x" }] };
    const mapped = pageUrisToFiles(payload, "/wc") as { textDocument: { text: string }; edits: { newText: string }[] };
    expect(mapped.textDocument.text).toBe("file: notes");
    expect(mapped.edits[0]?.newText).toBe("file:x");
  });
});
